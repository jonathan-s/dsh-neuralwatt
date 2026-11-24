/**
 * Account quota: the one endpoint this provider serves outside Chat
 * Completions.
 *
 * The report is cosmetic, so every failure degrades to "unavailable" instead of
 * failing a model request. The snapshot is cached briefly because both the agent
 * tool and the Web provider card read it, and an account balance does not change
 * between two keystrokes.
 *
 * @module dsh-neuralwatt-provider/quota
 */
import type { ResolvedOptions } from './options.js'

/** Subset of the quota endpoint this plugin reports. */
export interface QuotaResponse {
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

/** How long one quota snapshot stays fresh for every reader. */
export const QUOTA_CACHE_MS = 60_000

/** One cached snapshot, keyed by endpoint so a changed baseURL is not served stale data. */
let cache: { baseURL: string; at: number; value: QuotaResponse | undefined } | undefined

/** Forget the cached snapshot; the test suite calls this between cases. */
export function resetQuotaCache(): void {
  cache = undefined
}

/**
 * Read the account quota, tolerating every failure.
 * @param options - resolved settings naming the endpoint.
 * @param key - usable API key for this lookup.
 * @param signal - caller cancellation, so a closed card stops its own request.
 * @returns the parsed quota, or `undefined` when unavailable.
 */
export async function fetchQuota(
  options: ResolvedOptions,
  key: string,
  signal?: AbortSignal,
): Promise<QuotaResponse | undefined> {
  const cached = cache
  if (cached !== undefined && cached.baseURL === options.baseURL && Date.now() - cached.at < QUOTA_CACHE_MS) {
    return cached.value
  }
  let value: QuotaResponse | undefined
  try {
    const timeout = AbortSignal.timeout(8_000)
    const response = await fetch(`${options.baseURL}/quota`, {
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    if (response.ok) value = await response.json() as QuotaResponse
    else await response.body?.cancel().catch(() => {})
  } catch (_quotaUnavailable) {
    value = undefined
  }
  // Cache only a real snapshot: a transient failure must stay retryable.
  cache = value === undefined ? undefined : { baseURL: options.baseURL, at: Date.now(), value }
  return value
}

/** Compact human-readable report of account quota. */
export function quotaReport(quota: QuotaResponse | undefined): string[] {
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
