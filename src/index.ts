/**
 * Neuralwatt provider plugin for DeepSeek Harness.
 *
 * Registers the `neuralwatt` LLM route over the OpenAI-compatible Chat
 * Completions endpoint, exposes the ported model catalog to the picker, and
 * reports energy, billed cost, and account quota through a model-facing tool.
 *
 * @module dsh-neuralwatt-provider
 */
import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { NeuralwattAdapter } from './adapter.js'
import { Catalog } from './catalog.js'
import { captureComment, captureQueue, createTelemetry, formatEnergy } from './energy.js'
import { BlockBuilder, mapFinish, mapUsage, parseSse, providerError, serialize } from './wire.js'

/** Provider route this plugin owns. */
export const ROUTE = 'neuralwatt'

/** Plugin configuration. */
export interface Config {
  /** API root of the OpenAI-compatible endpoint. */
  baseURL: string
  /** Credential reference resolved through the credentials seam, then the launch environment. */
  apiKeyEnv: string
  /** Literal API key fallback; prefer `apiKeyEnv` so no secret enters configuration. */
  apiKey?: string
  /** Label shown by model selectors and provider diagnostics. */
  displayName: string
  /** Whether Neuralwatt's hosted tools stay available to the model. */
  hostedTools: boolean
  /** Log per-request energy, cost, and flex queue telemetry at debug level. */
  logEnergy: boolean
  /** Overall request deadline in milliseconds. */
  timeoutMs: number
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  baseURL: z.string().default('https://api.neuralwatt.com/v1')
    .description('API root of the OpenAI-compatible endpoint.'),
  apiKeyEnv: z.string().default('NEURALWATT_API_KEY')
    .description('Credential reference resolved per request; also the environment variable fallback.'),
  apiKey: z.string()
    .description('Literal API key fallback. Prefer apiKeyEnv, or put NEURALWATT_API_KEY in $DSH_HOME/.env.'),
  displayName: z.string().default('Neuralwatt')
    .description('Label shown by model selectors.'),
  hostedTools: z.boolean().default(true)
    .description('Leave Neuralwatt hosted tools available; false sends X-NW-Tools-Opt-Out.'),
  logEnergy: z.boolean().default(false)
    .description('Log per-request energy, billed cost, and flex queue telemetry at debug level.'),
  timeoutMs: z.number().default(900_000)
    .description('Overall request deadline in milliseconds.'),
})

export const name = 'llm-neuralwatt'
export const inject = ['llm']

/** Subset of the quota endpoint this plugin reports. */
interface QuotaResponse {
  balance?: { credits_remaining_usd?: number; credits_used_usd?: number }
  usage?: {
    lifetime?: { cost_usd?: number; requests?: number; tokens?: number; energy_kwh?: number }
    current_month?: { cost_usd?: number; requests?: number; tokens?: number; energy_kwh?: number }
  }
  subscription?: {
    plan?: string
    status?: string
    kwh_included?: number | null
    kwh_used?: number | null
    kwh_remaining?: number | null
  } | null
}

/**
 * Resolve the API key for one request.
 * @param ctx - plugin context.
 * @param config - resolved plugin configuration.
 * @returns the usable key.
 */
async function resolveApiKey(ctx: Context, config: Config): Promise<string> {
  const ref = credentialRef(config.apiKeyEnv)
  const credentials = ctx.get('credentials') as { resolve: (ref: CredentialRef) => Promise<{ value: string } | undefined> } | undefined
  const stored = credentials === undefined ? undefined : await credentials.resolve(ref)
  const candidate = stored?.value
    ?? launchEnvironmentOf(ctx).get(config.apiKeyEnv)?.value
    ?? (typeof process.env[config.apiKeyEnv] === 'string' ? process.env[config.apiKeyEnv] : undefined)
    ?? config.apiKey
  if (candidate === undefined || candidate.length === 0) {
    throw new Error(
      `llm-neuralwatt: no credential for the ${ROUTE} route. Put ${config.apiKeyEnv}=… in $DSH_HOME/.env, `
      + `export ${config.apiKeyEnv}, or store it through the credentials service.`,
    )
  }
  return assertUsableApiKey(candidate, 'llm-neuralwatt', config.apiKeyEnv)
}

/**
 * Fetch account quota, tolerating every failure: the report is cosmetic.
 * @param config - resolved configuration.
 * @param key - API key for this lookup.
 * @returns the parsed quota, or `undefined`.
 */
async function fetchQuota(config: Config, key: string): Promise<QuotaResponse | undefined> {
  try {
    const response = await fetch(`${config.baseURL.replace(/\/+$/, '')}/quota`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return undefined
    return await response.json() as QuotaResponse
  } catch (_quotaUnavailable) {
    return undefined
  }
}

/** Compact human-readable report of quota and process telemetry. */
function quotaReport(quota: QuotaResponse | undefined): string[] {
  if (quota === undefined) return ['Account quota: unavailable (check the API key or network).']
  const lines: string[] = []
  if (quota.subscription !== null && quota.subscription !== undefined) {
    const plan = quota.subscription.plan ?? 'unknown plan'
    const status = quota.subscription.status ?? 'unknown status'
    lines.push(`Subscription: ${plan} (${status})`)
    if (typeof quota.subscription.kwh_included === 'number') {
      lines.push(`Plan energy: ${quota.subscription.kwh_used ?? 0} / ${quota.subscription.kwh_included} kWh used`
        + ` (${quota.subscription.kwh_remaining ?? 0} kWh remaining)`)
    }
  }
  if (typeof quota.balance?.credits_remaining_usd === 'number') {
    lines.push(`Credits remaining: $${quota.balance.credits_remaining_usd.toFixed(2)}`)
  }
  if (quota.usage?.current_month !== undefined) {
    const month = quota.usage.current_month
    lines.push(`This month: $${(month.cost_usd ?? 0).toFixed(2)}, ${month.requests ?? 0} requests,`
      + ` ${(month.tokens ?? 0).toLocaleString('en-US')} tokens, ${(month.energy_kwh ?? 0).toFixed(3)} kWh`)
  }
  if (quota.usage?.lifetime !== undefined) {
    const lifetime = quota.usage.lifetime
    lines.push(`Lifetime: $${(lifetime.cost_usd ?? 0).toFixed(2)}, ${lifetime.requests ?? 0} requests,`
      + ` ${(lifetime.energy_kwh ?? 0).toFixed(3)} kWh`)
  }
  return lines
}

/**
 * Mount the route.
 * @param ctx - plugin context.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const catalog = new Catalog()
  const adapter = new NeuralwattAdapter({
    displayName: config.displayName,
    baseURL: config.baseURL,
    catalog,
    timeoutMs: config.timeoutMs,
    hostedTools: config.hostedTools,
    logEnergy: config.logEnergy,
    resolveApiKey: signal => resolveApiKey(ctx, config),
    attachments: () => ctx.get('attachments') as AttachmentStore | undefined,
    logger: {
      debug: message => ctx.logger.debug(message),
      warn: message => ctx.logger.warn(message),
    },
  })
  ctx.llm.registerAdapter([ROUTE], adapter)
  ctx.logger.warn(`llm-neuralwatt: mounted ${catalog.list(ROUTE).length} models at ${config.baseURL}`)

  ctx.inject(['tools'], (child) => {
    child.tools.register(defineTool({
      name: 'neuralwatt_status',
      description:
        'Report Neuralwatt account quota (plan, credits, energy) and this process\'s token, energy, and billed-cost '
        + 'totals. Use it when the user asks about spend, energy use, or remaining credits for the Neuralwatt route.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { report: { type: 'string', required: true } },
        },
        render: (_args: unknown, value: { report: string }) => [{ type: 'text' as const, text: value.report }],
      },
      async execute() {
        const stats = adapter.snapshot()
        const lines = [
          `Neuralwatt route (${config.baseURL})`,
          `Requests this process: ${stats.requests} (${stats.failed} failed)`,
          `Tokens this process: ${stats.inputTokens.toLocaleString('en-US')} in, ${stats.outputTokens.toLocaleString('en-US')} out`,
          `Energy this process: ${formatEnergy(stats.energyJoules)}; billed $${stats.costUsd.toFixed(6)}`,
          ...stats.lastQueueSeconds === undefined ? [] : [`Last flex queue wait: ${stats.lastQueueSeconds.toFixed(1)} s`],
          '',
        ]
        let quota: QuotaResponse | undefined
        try {
          quota = await fetchQuota(config, await resolveApiKey(ctx, config))
        } catch (_missingKey) {
          lines.push('Account quota: unavailable (no API key resolved).')
        }
        lines.push(...quotaReport(quota))
        return { report: lines.join('\n') }
      },
    }))
  })
}

/**
 * Internal seams exposed for the offline test suite. Not part of the plugin
 * contract: a bundle consumer mounts {@link apply} and nothing else.
 * @internal
 */
export const __internals = {
  Catalog,
  NeuralwattAdapter,
  serialize,
  parseSse,
  BlockBuilder,
  mapUsage,
  mapFinish,
  providerError,
  captureComment,
  captureQueue,
  createTelemetry,
  formatEnergy,
} as const
