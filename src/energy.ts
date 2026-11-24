/**
 * Neuralwatt telemetry: the endpoint reports energy accounting and billed cost
 * as SSE comments (`: energy {...}`, `: cost {...}`) beside the token stream,
 * and flex-tier requests queue server-side with empty-delta heartbeats.
 * This module reads those side-channel frames without touching the payloads the
 * adapter already parses.
 *
 * @module dsh-neuralwatt-provider/energy
 */

/** Per-request telemetry recovered from one response stream. */
export interface EnergyTelemetry {
  /** Joules reported by every `: energy` frame in this response. */
  energyJoules: number
  /** Billed cost in USD reported by every `: cost` frame. */
  costUsd: number
  /** Server queue wait implied by flex heartbeats, when the stream emitted them. */
  queueSeconds?: number
  /** Last raw `: energy` payload, for diagnostics. */
  energyRaw?: unknown
  /** Last raw `: cost` payload, for diagnostics. */
  costRaw?: unknown
  /** Last raw `: mcr-session` payload, for diagnostics. */
  mcrSession?: unknown
}

/** Fresh telemetry accumulator for one response. */
export function createTelemetry(): EnergyTelemetry {
  return { energyJoules: 0, costUsd: 0 }
}

/** Prefixed SSE comments this module recognizes. */
const PREFIXES = [
  { prefix: 'energy ', apply: (state: EnergyTelemetry, value: Record<string, any>) => {
    if (typeof value.energy_joules === 'number') state.energyJoules += value.energy_joules
    state.energyRaw = value
  } },
  { prefix: 'cost ', apply: (state: EnergyTelemetry, value: Record<string, any>) => {
    if (typeof value.request_cost_usd === 'number') state.costUsd += value.request_cost_usd
    state.costRaw = value
  } },
  { prefix: 'mcr-session ', apply: (state: EnergyTelemetry, value: Record<string, any>) => {
    state.mcrSession = value
  } },
] as const

/**
 * Read one SSE comment frame into the accumulator.
 * @param comment - frame text after the leading colon, already trimmed.
 * @param state - accumulator for this response.
 * @returns whether the frame was a recognized telemetry frame.
 */
export function captureComment(comment: string, state: EnergyTelemetry): boolean {
  for (const entry of PREFIXES) {
    if (!comment.startsWith(entry.prefix)) continue
    try {
      const value: unknown = JSON.parse(comment.slice(entry.prefix.length))
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        entry.apply(state, value as Record<string, any>)
        return true
      }
    } catch (_malformedTelemetry) {
      // A malformed side-channel frame never fails the model response.
    }
    return false
  }
  return false
}

/** Queue-wait tracker for one response stream. */
export interface QueueTracker {
  firstHeartbeatCreated?: number
  sawContent: boolean
}

/**
 * Note one `data:` payload for flex queue accounting. Heartbeats are chunks
 * whose `delta` object is empty; the first chunk carrying a delta ends the wait.
 * @param payload - raw `data:` payload.
 * @param state - telemetry accumulator.
 * @param tracker - queue bookkeeping for this response.
 */
export function captureQueue(payload: string, state: EnergyTelemetry, tracker: QueueTracker): void {
  if (tracker.sawContent) return
  const created = /"created"\s*:\s*(\d+)/.exec(payload)
  const createdAt = created === null ? undefined : Number(created[1])
  if (/"delta"\s*:\s*\{\s*\}/.test(payload)) {
    if (tracker.firstHeartbeatCreated === undefined && createdAt !== undefined) tracker.firstHeartbeatCreated = createdAt
    return
  }
  if (!/"delta"\s*:\s*\{[^}]/.test(payload)) return
  tracker.sawContent = true
  if (tracker.firstHeartbeatCreated !== undefined && createdAt !== undefined) {
    state.queueSeconds = Math.max(0, createdAt - tracker.firstHeartbeatCreated)
  }
}

/** Formatting helpers used by the status tool. */
export function formatEnergy(joules: number): string {
  if (!Number.isFinite(joules) || joules <= 0) return '0 J'
  if (joules < 1000) return `${joules.toFixed(1)} J`
  const kwh = joules / 3_600_000
  if (kwh >= 1) return `${kwh.toFixed(3)} kWh`
  const wh = joules / 3600
  if (wh >= 1) return `${wh.toFixed(3)} Wh`
  return `${(joules / 1000).toFixed(3)} mWh`
}
