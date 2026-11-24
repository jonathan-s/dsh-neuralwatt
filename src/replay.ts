/**
 * The versioned replay envelope this adapter stores on each assistant message.
 *
 * DSH hands `replayState` back only to the adapter instance that owns the
 * historical route, so a foreign provider's metadata can never be misread. This
 * module keeps three facts there:
 *
 * - `blocks` — per-block metadata aligned with the emitted Harness blocks, which
 *   is what makes a response replayable;
 * - `telemetry` — the energy, billed cost, and flex queue wait Neuralwatt
 *   reports as SSE side-channel frames. It is durable here because that is the
 *   only per-response adapter metadata the session log persists, and a session
 *   projection folds it into per-session totals;
 * - `model` — the exact model that produced the response, so preserved thinking
 *   is replayed only back to the model that authored it.
 *
 * @module dsh-neuralwatt-provider/replay
 */
import type { ReplayEnvelope } from '@deepseek-ai/dsh-llm'

/** Envelope kind and version; bump the version when the shape changes. */
export const REPLAY_KIND = 'neuralwatt-chat'

/** Current envelope version. */
export const REPLAY_VERSION = 1

/** One emitted block's replay metadata, aligned by index with the Harness block. */
export interface ReplayBlock {
  type: 'text' | 'reasoning' | 'tool-call'
}

/** Per-response telemetry recovered from the response stream. */
export interface ResponseTelemetry {
  /** Joules reported by every `: energy` frame in this response. */
  energyJoules: number
  /** Billed cost in USD reported by every `: cost` frame. */
  costUsd: number
  /**
   * Grams of CO₂ equivalent reported beside the energy accounting. Absent on
   * envelopes written before carbon was captured, which reads as unknown rather
   * than as a measured zero.
   */
  carbonGrams?: number
  /** Server queue wait implied by flex heartbeats, when the stream emitted them. */
  queueSeconds?: number
  /** Grid the reporting node drew from. */
  gridId?: string
  /** That grid's carbon intensity in grams of CO₂ per kWh. */
  gridIntensityGco2PerKwh?: number
  /** How the grid facts were obtained (`agent_cache`, `regional_fallback`, …). */
  carbonSource?: string
}

/** Decoded envelope, detached from the durable message source. */
export interface DecodedReplay {
  /** Model that produced the response. */
  model: string
  /** Per-block metadata in emitted block order. */
  blocks?: readonly ReplayBlock[]
  /** Telemetry captured beside the response, when the stream reported any. */
  telemetry?: ResponseTelemetry
}

/** A finite, non-negative number, or undefined. */
function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Decode one durable replay value, returning undefined for anything foreign. */
function decode(raw: unknown): DecodedReplay | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') return undefined
  const envelope = raw as { response?: unknown; blocks?: unknown }
  const response = envelope.response
  if (response === undefined || response === null || typeof response !== 'object') return undefined
  const fields = response as Record<string, unknown>
  if (fields.kind !== REPLAY_KIND || fields.version !== REPLAY_VERSION) return undefined
  if (typeof fields.model !== 'string' || fields.model.length === 0) return undefined
  const telemetryFields = fields.telemetry
  let telemetry: ResponseTelemetry | undefined
  if (telemetryFields !== undefined && telemetryFields !== null && typeof telemetryFields === 'object') {
    const source = telemetryFields as Record<string, unknown>
    const energyJoules = amount(source.energyJoules)
    const costUsd = amount(source.costUsd)
    if (energyJoules !== undefined && costUsd !== undefined) {
      const queueSeconds = amount(source.queueSeconds)
      const gridIntensityGco2PerKwh = amount(source.gridIntensityGco2PerKwh)
      const gridId = typeof source.gridId === 'string' && source.gridId.length > 0 ? source.gridId : undefined
      const carbonSource = typeof source.carbonSource === 'string' && source.carbonSource.length > 0
        ? source.carbonSource
        : undefined
      const carbonGrams = amount(source.carbonGrams)
      telemetry = {
        energyJoules,
        costUsd,
        ...carbonGrams === undefined ? {} : { carbonGrams },
        ...queueSeconds === undefined ? {} : { queueSeconds },
        ...gridId === undefined ? {} : { gridId },
        ...gridIntensityGco2PerKwh === undefined ? {} : { gridIntensityGco2PerKwh },
        ...carbonSource === undefined ? {} : { carbonSource },
      }
    }
  }
  let blocks: ReplayBlock[] | undefined
  if (Array.isArray(envelope.blocks)) {
    const decoded: ReplayBlock[] = []
    let usable = true
    for (const entry of envelope.blocks) {
      if (entry === null || typeof entry !== 'object') {
        usable = false
        break
      }
      const type = (entry as Record<string, unknown>).type
      if (type !== 'text' && type !== 'reasoning' && type !== 'tool-call') {
        usable = false
        break
      }
      decoded.push({ type })
    }
    // A malformed block list costs replay, never the telemetry stored beside it.
    if (usable) blocks = decoded
  }
  return { model: fields.model, ...blocks === undefined ? {} : { blocks }, ...telemetry === undefined ? {} : { telemetry } }
}

/**
 * Build the envelope carried by one terminal finish chunk.
 * @param model - exact model that produced the response.
 * @param blocks - per-block metadata in emitted block order.
 * @param telemetry - telemetry captured beside the response.
 * @returns a lossless-JSON envelope the session log can persist.
 */
export function replayEnvelope(
  model: string,
  blocks: readonly ReplayBlock[],
  telemetry: ResponseTelemetry | undefined,
): ReplayEnvelope {
  return {
    response: {
      kind: REPLAY_KIND,
      version: REPLAY_VERSION,
      model,
      ...telemetry === undefined ? {} : {
        telemetry: {
          energyJoules: telemetry.energyJoules,
          costUsd: telemetry.costUsd,
          ...telemetry.carbonGrams === undefined ? {} : { carbonGrams: telemetry.carbonGrams },
          ...telemetry.queueSeconds === undefined ? {} : { queueSeconds: telemetry.queueSeconds },
          ...telemetry.gridId === undefined ? {} : { gridId: telemetry.gridId },
          ...telemetry.gridIntensityGco2PerKwh === undefined ? {} : { gridIntensityGco2PerKwh: telemetry.gridIntensityGco2PerKwh },
          ...telemetry.carbonSource === undefined ? {} : { carbonSource: telemetry.carbonSource },
        },
      },
    },
    blocks,
  }
}

/**
 * Read telemetry out of one durable replay value, whatever model produced it.
 * @param raw - the assistant message's `source.replayState`, if any.
 * @returns the telemetry, or undefined for foreign or older values.
 */
export function readTelemetry(raw: unknown): ResponseTelemetry | undefined {
  return decode(raw)?.telemetry
}

/**
 * Read replay metadata for one exact model, degrading to undefined for foreign,
 * cross-model, or malformed values rather than failing the history.
 * @param raw - the assistant message's `source.replayState`, if any.
 * @param model - the model this request targets.
 * @returns block metadata when the envelope names that exact model, otherwise undefined.
 */
export function readReplay(raw: unknown, model: string): DecodedReplay | undefined {
  const decoded = decode(raw)
  if (decoded === undefined || decoded.model !== model || decoded.blocks === undefined) return undefined
  return decoded
}
