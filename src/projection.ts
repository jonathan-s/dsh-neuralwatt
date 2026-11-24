/**
 * Per-session Neuralwatt usage, folded from the session log.
 *
 * The session log is the source of truth: each assistant message's
 * `source.replayState` carries the energy, billed cost, and flex queue wait that
 * Neuralwatt streamed beside the response, and its event carries token usage. A
 * projection folds those durable facts so the Web client receives one
 * schema-validated per-session value, and the status tool reports the same
 * numbers a reload, resume, or fork reproduces — instead of process counters
 * that reset on restart and mix sessions together.
 *
 * @module dsh-neuralwatt-provider/projection
 */
import { ROUTE } from './routes.js'
import { readTelemetry } from './replay.js'

/** Projection key consumed by the Web client through `useProjection`. */
export const PROJECTION_KEY = 'neuralwattUsage'

/** One session's totals for the Neuralwatt route. */
export interface NeuralwattUsageView {
  /** Route these totals belong to; the last route that produced a counted message. */
  provider: string
  /** Assistant messages from this route in the session. */
  requests: number
  /** Uncached input tokens. */
  inputTokens: number
  /** Output tokens, including reasoning tokens. */
  outputTokens: number
  /** Cached input tokens reported separately. */
  cacheReadTokens: number
  /** Joules reported beside these responses. */
  energyJoules: number
  /** Billed cost in USD reported beside these responses. */
  costUsd: number
  /** Last flex queue wait observed in this session. */
  lastQueueSeconds?: number
  /** Model that produced the most recent counted message. */
  lastModel?: string
}

/** Fold state is the published view; keeping them one value preserves references. */
export type NeuralwattUsageState = NeuralwattUsageView

/** The zero value of a session that has not used this route. */
export const EMPTY_USAGE: NeuralwattUsageState = Object.freeze({
  provider: ROUTE,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  energyJoules: 0,
  costUsd: 0,
})

/** Minimal schema contract the session-projection registry calls (`parse`). */
interface SchemaLike<T> {
  parse(value: unknown): T
}

/** A finite non-negative number, or 0 for an unusable one. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Validate one stored or published usage value. */
function createUsageSchema(): SchemaLike<NeuralwattUsageState> {
  return {
    parse(value: unknown): NeuralwattUsageState {
      if (value === null || typeof value !== 'object') {
        throw new TypeError(`${PROJECTION_KEY}: expected an object`)
      }
      const source = value as Record<string, unknown>
      if (typeof source.provider !== 'string' || source.provider.length === 0) {
        throw new TypeError(`${PROJECTION_KEY}: provider must be a non-empty string`)
      }
      const lastQueueSeconds = source.lastQueueSeconds
      const lastModel = source.lastModel
      return {
        provider: source.provider,
        requests: count(source.requests),
        inputTokens: count(source.inputTokens),
        outputTokens: count(source.outputTokens),
        cacheReadTokens: count(source.cacheReadTokens),
        energyJoules: count(source.energyJoules),
        costUsd: count(source.costUsd),
        ...typeof lastQueueSeconds === 'number' && Number.isFinite(lastQueueSeconds) && lastQueueSeconds >= 0
          ? { lastQueueSeconds }
          : {},
        ...typeof lastModel === 'string' && lastModel.length > 0 ? { lastModel } : {},
      }
    },
  }
}

/**
 * Fold one committed session event into the session's Neuralwatt totals.
 *
 * Pure and synchronous; an event that concerns another route returns the same
 * reference so the registry does no downstream work.
 * @param state - totals before this event.
 * @param event - one committed session event.
 * @returns the next totals, or the same reference when nothing changed.
 */
export function applyUsage(state: NeuralwattUsageState, event: unknown): NeuralwattUsageState {
  if (event === null || typeof event !== 'object') return state
  const record = event as { type?: unknown; data?: unknown }
  if (record.type !== 'assistant/message') return state
  const data = record.data
  if (data === null || typeof data !== 'object') return state
  const payload = data as { message?: unknown; usage?: unknown }
  const message = payload.message
  if (message === null || typeof message !== 'object') return state
  const source = (message as { source?: unknown }).source
  if (source === null || typeof source !== 'object') return state
  const sourceFields = source as { kind?: unknown; provider?: unknown; model?: unknown; replayState?: unknown }
  if (sourceFields.kind !== 'model' || sourceFields.provider !== ROUTE) return state
  const telemetry = readTelemetry(sourceFields.replayState)
  const usage = payload.usage
  const usageFields = usage !== null && typeof usage === 'object'
    ? usage as Record<string, unknown>
    : undefined
  if (telemetry === undefined && usageFields === undefined) return state
  const model = typeof sourceFields.model === 'string' && sourceFields.model.length > 0
    ? sourceFields.model
    : undefined
  return {
    provider: ROUTE,
    requests: state.requests + 1,
    inputTokens: state.inputTokens + count(usageFields?.inputTokens),
    outputTokens: state.outputTokens + count(usageFields?.outputTokens),
    cacheReadTokens: state.cacheReadTokens + count(usageFields?.cacheReadTokens),
    energyJoules: state.energyJoules + (telemetry?.energyJoules ?? 0),
    costUsd: state.costUsd + (telemetry?.costUsd ?? 0),
    ...telemetry?.queueSeconds === undefined
      ? state.lastQueueSeconds === undefined ? {} : { lastQueueSeconds: state.lastQueueSeconds }
      : { lastQueueSeconds: telemetry.queueSeconds },
    ...model === undefined
      ? state.lastModel === undefined ? {} : { lastModel: state.lastModel }
      : { lastModel: model },
  }
}

/**
 * The projection unit the Host registry installs.
 *
 * `summary: false` keeps this value off Session list rows: a list row only needs
 * a title, and a usage total is read when a session is opened.
 */
export const usageProjectionDefinition = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: createUsageSchema(),
  init: (): NeuralwattUsageState => EMPTY_USAGE,
  apply: applyUsage,
  wire: {
    viewSchema: createUsageSchema(),
    view: (state: NeuralwattUsageState): NeuralwattUsageState => state,
    summary: false,
  },
} as const
