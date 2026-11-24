/**
 * Neuralwatt provider plugin for DeepSeek Harness.
 *
 * Registers the `neuralwatt` LLM route over the OpenAI-compatible Chat
 * Completions endpoint, advertises the ported model catalog to selectors and
 * discovery, folds Neuralwatt's energy telemetry into a durable per-session
 * projection, and reports session usage plus account quota through a
 * model-facing tool and a provider-card route.
 *
 * Every capability beyond the route itself is optional: the plugin mounts on
 * `llm` alone, and contributes tools, discovery, telemetry, and the Web card
 * only where the composition provides their services.
 *
 * @module dsh-neuralwatt-provider
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NeuralwattAdapter } from './adapter.js'
import { Catalog } from './catalog.js'
import { resolveApiKey } from './credentials.js'
import { discoverModels } from './discovery.js'
import { formatEnergy } from './energy.js'
import {
  BASE_URL_ENV,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  Config,
  registrationFacts,
  resolveOptions,
} from './options.js'
import type { ResolvedOptions } from './options.js'
import { PROJECTION_KEY, applyUsage, usageProjectionDefinition } from './projection.js'
import type { NeuralwattUsageView } from './projection.js'
import { fetchQuota, quotaReport } from './quota.js'
import { QUOTA_PATH, ROUTE, SETTINGS_NAMESPACE_FALLBACK } from './routes.js'
import { resolveRequestImageTarget } from './images.js'
import { parseModelListing } from './discovery.js'
import { quotaReport as renderQuotaReport } from './quota.js'
import { readTelemetry, replayEnvelope } from './replay.js'
import {
  BlockBuilder,
  mapFinish,
  mapUsage,
  parseSse,
  providerError,
  serialize,
} from './wire.js'
import { captureComment, captureQueue, createTelemetry } from './energy.js'

export { Config } from './options.js'
export { ROUTE } from './routes.js'
export { PROJECTION_KEY, usageProjectionDefinition } from './projection.js'

export const name = 'llm-neuralwatt'
export const inject = ['llm']

/** Structural face of the session-projection registry, which is optional. */
interface ProjectionRegistry {
  register(definition: unknown): Promise<{ stateOf(session: unknown): unknown }>
}

/** Structural face of the exact-path Fetch route registry, which is optional. */
interface FetchRegistry {
  register(route: {
    readonly path: string
    readonly methods: readonly ('GET' | 'HEAD')[]
    readonly requestBody: 'buffered'
    readonly fetch: (request: Request) => Promise<Response>
  }): () => Promise<void>
}

/** Structural face of the configurable-provider directory service. */
interface DirectoryRegistry {
  replace(entries: readonly unknown[]): void
}

/** Read one configurable-provider entry for this route. */
function directoryEntry(options: ResolvedOptions, settingsNs: string) {
  return {
    provider: ROUTE,
    displayName: options.displayName,
    settingsNs,
    settingsPath: [] as string[],
    defaultBaseURL: DEFAULT_BASE_URL,
    baseURLEnv: [BASE_URL_ENV],
    nativeAuth: { env: [DEFAULT_API_KEY_ENV], oauth: false },
  }
}

/** Resolve this plugin's settings namespace: its loader entry id. */
function settingsNamespaceOf(ctx: Context): string {
  const fiber = (ctx as unknown as { fiber?: { entry?: { options?: { id?: string } } } }).fiber
  const id = fiber?.entry?.options?.id
  return typeof id === 'string' && id.length > 0 ? id : SETTINGS_NAMESPACE_FALLBACK
}

/**
 * Mount the route.
 * @param ctx - plugin context.
 * @param config - resolved plugin configuration; every field is a live reference.
 */
export function apply(ctx: Context, config: Config): void {
  const settingsNs = settingsNamespaceOf(ctx)
  const options = (): ResolvedOptions => resolveOptions(config, launchEnvironmentOf(ctx))
  const catalog = new Catalog()
  const adapter = new NeuralwattAdapter({
    options,
    catalog,
    resolveApiKey: () => resolveApiKey(ctx, options().apiKeyEnv),
    attachments: () => ctx.get('attachments') as AttachmentStore | undefined,
    logger: {
      debug: message => ctx.logger.debug(message),
      warn: message => ctx.logger.warn(message),
    },
  })
  const registration = ctx.llm.registerAdapter([ROUTE], adapter)
  ctx.logger.debug(`llm-neuralwatt: mounted ${catalog.list(ROUTE).length} models at ${options().baseURL}`)

  // The configuration surface's directory entry: the route is discoverable, its
  // endpoint and credential variable are known, and it carries the Settings
  // namespace its volatile fields live in.
  const directory = ctx.llm.registerConfigurableProviders([directoryEntry(options(), settingsNs)]) as DirectoryRegistry
  ctx.llm.registerModelDiscovery(
    settingsNs,
    (request, signal) => discoverModels(signal === undefined ? request : { ...request, signal }, catalog),
  )

  // The registry captures the display name and retry policy at registration, so
  // a change to either re-registers the route; everything else is read per
  // request and needs no re-registration.
  let facts = registrationFacts(options())
  let directoryFacts = JSON.stringify(directoryEntry(options(), settingsNs))
  ctx.on('loader/volatile-update', () => {
    try {
      const next = options()
      const entry = directoryEntry(next, settingsNs)
      if (registrationFacts(next) !== facts) {
        registration.replace([ROUTE])
        facts = registrationFacts(next)
      }
      const nextDirectory = JSON.stringify(entry)
      if (nextDirectory !== directoryFacts) {
        directory.replace([entry])
        directoryFacts = nextDirectory
      }
    } catch (error) {
      ctx.logger.warn('llm-neuralwatt: configuration update was refused; the previous settings stay active')
      ctx.logger.warn(error)
    }
  })

  // Per-session usage folded from the durable log, published to every client
  // carrier through the projection's wire view.
  let usageOf: ((session: unknown) => NeuralwattUsageView | undefined) | undefined
  ctx.inject(['sessionProjections'], (child) => {
    const registry = (child as unknown as { sessionProjections: ProjectionRegistry }).sessionProjections
    void registry.register(usageProjectionDefinition).then((handle) => {
      usageOf = session => handle.stateOf(session) as NeuralwattUsageView | undefined
    }).catch((error: unknown) => {
      child.logger.warn('llm-neuralwatt: session usage projection was refused')
      child.logger.warn(error)
    })
  })

  // Account quota for the Web provider card. The route joins the browser's
  // authenticated exact-path Fetch registry; without a Web carrier it is absent.
  ctx.inject(['connection'], (child) => {
    const fetchRoutes = (child as unknown as { connection: { fetch: FetchRegistry } }).connection.fetch
    void fetchRoutes.register({
      path: QUOTA_PATH,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-type': 'application/json' } })
        const live = options()
        try {
          const key = await resolveApiKey(ctx, live.apiKeyEnv)
          const quota = await fetchQuota(live, key)
          return Response.json({ configured: true, route: ROUTE, quota: quota ?? null }, {
            status: 200,
            headers: { 'cache-control': 'no-store' },
          })
        } catch (error) {
          return Response.json({
            configured: false,
            route: ROUTE,
            error: error instanceof Error ? error.message : 'quota unavailable',
          }, { status: 200, headers: { 'cache-control': 'no-store' } })
        }
      },
    })
  })

  // The model-facing status tool exists only for a step that routes to this
  // provider, so an unrelated session is not offered a Neuralwatt tool.
  ctx.inject(['tools'], (child) => {
    child.tools.register(defineTool({
      name: 'neuralwatt_status',
      description:
        'Report Neuralwatt usage for this session (requests, tokens, energy, billed cost, last flex queue wait) and the '
        + 'account quota (plan, credits, monthly and lifetime spend). Use it when the user asks about spend, energy use, '
        + 'or remaining credits for the Neuralwatt route.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { report: { type: 'string', required: true } },
        },
        render: (_args: unknown, value: { report: string }) => [{ type: 'text' as const, text: value.report }],
      },
      async execute(_args, exec) {
        const live = options()
        const session = exec.agent?.session
        const usage = session === undefined ? undefined : usageOf?.(session)
        const lines = [`Neuralwatt route: ${live.baseURL}`]
        if (usage === undefined || usage.requests === 0) {
          lines.push('Session usage: no Neuralwatt response recorded in this session yet.')
        } else {
          lines.push(
            `Session requests: ${usage.requests}`,
            `Session tokens: ${usage.inputTokens.toLocaleString('en-US')} in, `
            + `${usage.outputTokens.toLocaleString('en-US')} out`
            + (usage.cacheReadTokens > 0 ? `, ${usage.cacheReadTokens.toLocaleString('en-US')} cached` : ''),
            `Session energy: ${formatEnergy(usage.energyJoules)}; billed $${usage.costUsd.toFixed(6)}`,
          )
          if (usage.lastQueueSeconds !== undefined) lines.push(`Last flex queue wait: ${usage.lastQueueSeconds.toFixed(1)} s`)
        }
        lines.push('')
        try {
          const key = await resolveApiKey(ctx, live.apiKeyEnv)
          lines.push(...quotaReport(await fetchQuota(live, key, exec.signal)))
        } catch (_missingKey) {
          lines.push('Account quota: unavailable (no credential resolved).')
        }
        return { report: lines.join('\n') }
      },
    }), { when: ({ modelSelection }) => modelSelection.provider === ROUTE })
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
  resolveOptions,
  registrationFacts,
  applyUsage,
  usageProjectionDefinition,
  PROJECTION_KEY,
  readTelemetry,
  replayEnvelope,
  resolveRequestImageTarget,
  parseModelListing,
  quotaReport: renderQuotaReport,
} as const
