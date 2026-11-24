/**
 * Plugin configuration and its per-operation resolution.
 *
 * Every user-facing field is a `Volatile` reference, as the shipped providers
 * declare them: the plugin reads the current value on each request, a settings
 * or config-editor write takes effect on the next request without a restart,
 * and the route is re-registered only when a fact the LLM registry captured at
 * registration time (the retry policy) changes.
 *
 * @module dsh-neuralwatt-provider/options
 */
import type { Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError, RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import z from '@deepseek-ai/schemastery'

/** Package name used in diagnostics, and the loader row id this bundle inserts. */
export const PACKAGE = 'llm-neuralwatt'

/** Public API root of the OpenAI-compatible endpoint. */
export const DEFAULT_BASE_URL = 'https://api.neuralwatt.com/v1'

/** Environment variable naming the endpoint, honored only from trusted layers. */
export const BASE_URL_ENV = 'NEURALWATT_BASE_URL'

/** Default credential reference, also the shell-variable spelling. */
export const DEFAULT_API_KEY_ENV = 'NEURALWATT_API_KEY'

/** Default idle interval while one stream read is outstanding (five minutes). */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000

/** Default overall request deadline (fifteen minutes). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 900_000

/** Plugin configuration as the Loader supplies it: every field a live reference. */
export interface Config {
  /** Endpoint root; falls back to `$NEURALWATT_BASE_URL`, then the public API. */
  baseURL: Volatile<string>
  /** Credential reference resolved per request; never a secret. */
  apiKeyEnv: Volatile<string>
  /** Label shown by model selectors and provider diagnostics. */
  displayName: Volatile<string>
  /** Whether Neuralwatt's hosted tools stay available to the model. */
  hostedTools: Volatile<boolean>
  /** Log per-request energy, billed cost, and flex queue telemetry at debug level. */
  logEnergy: Volatile<boolean>
  /** Maximum provider idle time while one stream read is outstanding. */
  idleTimeoutMs: Volatile<number>
  /** Overall request deadline in milliseconds. */
  requestTimeoutMs: Volatile<number>
  /** Provider-owned retry policy; omission uses normal mode with five retries. */
  retryPolicy: Volatile<RetryPolicyConfig | undefined>
}

/** Plain options accepted by the resolver and by programmatic mounts. */
export type Options = {
  baseURL?: string
  apiKeyEnv?: string
  displayName?: string
  hostedTools?: boolean
  logEnergy?: boolean
  idleTimeoutMs?: number
  requestTimeoutMs?: number
  retryPolicy?: RetryPolicyConfig
}

/** Shim: `Volatile<T>` is a live reference with `get()`, plain T is a fixed value. */
function take<T>(value: T | Volatile<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  const ref = value as { get?: () => T }
  return typeof ref.get === 'function' ? ref.get() : value as T
}

/** Complete request-local settings captured for one operation. */
export interface ResolvedOptions {
  /** Validated endpoint root without a trailing slash. */
  baseURL: string
  /** Branded credential reference. */
  apiKeyEnv: CredentialRef
  /** Non-empty provider label. */
  displayName: string
  hostedTools: boolean
  logEnergy: boolean
  idleTimeoutMs: number
  requestTimeoutMs: number
  retryPolicy: ResolvedRetryPolicy
}

/** Loader schema for the plugin row; the interface above names its resolved values. */
export const Config = z.object({
  baseURL: z.string().volatile()
    .description(`API root of the OpenAI-compatible endpoint; defaults to ${DEFAULT_BASE_URL} or $${BASE_URL_ENV}.`),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile()
    .description('Credential reference resolved per request through the harness credential seam.'),
  displayName: z.string().default('Neuralwatt').volatile()
    .description('Label shown by model selectors and provider diagnostics.'),
  hostedTools: z.boolean().default(true).volatile()
    .description('Leave Neuralwatt hosted tools available; false sends X-NW-Tools-Opt-Out.'),
  logEnergy: z.boolean().default(false).volatile()
    .description('Log per-request energy, billed cost, and flex queue telemetry at debug level.'),
  idleTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_IDLE_TIMEOUT_MS).volatile()
    .description('Maximum provider idle time in milliseconds while one stream read is outstanding.'),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS).volatile()
    .description('Overall request deadline in milliseconds, including time spent queued.'),
  retryPolicy: RetryPolicySchema.volatile()
    .description('Provider-owned model-request retry policy; omission uses normal mode with five retries.'),
})

/** Refuse durable data with a coded failure rather than a bare Error. */
function invalidConfig(detail: string): LlmError {
  return new LlmError(`${PACKAGE}: ${detail}`, 'INVALID_CONFIG')
}

/** Validate one endpoint root: HTTP(S), no credentials, query, or fragment. */
function resolveBaseURL(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_BASE_URL).trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (_notAUrl) {
    throw invalidConfig(`baseURL "${value}" is not an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidConfig('baseURL must use HTTP or HTTPS')
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw invalidConfig('baseURL must not carry credentials, a query, or a fragment')
  }
  return value.replace(/\/+$/, '')
}

/** Validate one millisecond bound. */
function resolveTimeout(name: string, raw: number | undefined, fallback: number): number {
  const value = raw ?? fallback
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw invalidConfig(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return value
}

/**
 * Resolve, validate, and detach every setting one operation needs.
 *
 * Reads the current reference values, so a settings write reaches the next
 * request; validation repeats here because a programmatic mount can bypass the
 * Loader schema.
 * @param config - the plugin row's configuration, volatile or plain.
 * @param environment - this run's environment layers, or `undefined` outside a profile launch.
 * @returns the resolved settings for one request, directory entry, or status report.
 */
export function resolveOptions(
  config: Config | Options | undefined,
  environment?: LaunchEnvironmentSnapshot,
): ResolvedOptions {
  const raw = (config ?? {}) as Record<string, unknown>
  const fromEnvironment = environment?.get(BASE_URL_ENV)?.value
  const baseURL = resolveBaseURL(take(raw.baseURL as string | undefined) ?? fromEnvironment)
  const displayName = (take(raw.displayName as string | undefined) ?? 'Neuralwatt').trim()
  if (displayName.length === 0) throw invalidConfig('displayName must not be blank')
  let apiKeyEnv: CredentialRef
  try {
    apiKeyEnv = credentialRef(take(raw.apiKeyEnv as string | undefined) ?? DEFAULT_API_KEY_ENV)
  } catch (error) {
    throw new LlmError(`${PACKAGE}: apiKeyEnv must be a shell-style identifier such as NEURALWATT_API_KEY`, 'INVALID_CONFIG', { cause: error })
  }
  let retryPolicy: ResolvedRetryPolicy
  try {
    retryPolicy = resolveRetryPolicy(
      take(raw.retryPolicy as RetryPolicyConfig | undefined),
      `${PACKAGE}: retryPolicy`,
    )
  } catch (error) {
    throw new LlmError(`${PACKAGE}: ${error instanceof Error ? error.message : String(error)}`, 'INVALID_CONFIG', { cause: error })
  }
  return {
    baseURL,
    apiKeyEnv,
    displayName,
    hostedTools: take(raw.hostedTools as boolean | undefined) ?? true,
    logEnergy: take(raw.logEnergy as boolean | undefined) ?? false,
    idleTimeoutMs: resolveTimeout('idleTimeoutMs', take(raw.idleTimeoutMs as number | undefined), DEFAULT_IDLE_TIMEOUT_MS),
    requestTimeoutMs: resolveTimeout('requestTimeoutMs', take(raw.requestTimeoutMs as number | undefined), DEFAULT_REQUEST_TIMEOUT_MS),
    retryPolicy,
  }
}

/** Compare the two resolved settings that force a route re-registration. */
export function registrationFacts(options: ResolvedOptions): string {
  return JSON.stringify({
    name: options.displayName,
    retryPolicy: options.retryPolicy,
  })
}
