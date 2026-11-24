/**
 * The Neuralwatt adapter: one route (`neuralwatt`) over the OpenAI-compatible
 * Chat Completions endpoint, with vision, reasoning efforts, tool calls, and
 * energy telemetry.
 *
 * @module dsh-neuralwatt-provider/adapter
 */
import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { Catalog } from './catalog.js'
import type { CatalogModel } from './catalog.js'
import { captureComment, captureQueue, createTelemetry } from './energy.js'
import type { EnergyTelemetry, QueueTracker } from './energy.js'
import { BlockBuilder, mapFinish, mapUsage, parseSse, providerError, serialize } from './wire.js'
import type { ImageMap } from './wire.js'

/** Aggregated per-process usage, reported by the status tool. */
export interface AdapterStats {
  requests: number
  failed: number
  energyJoules: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  lastQueueSeconds?: number
}

/** Everything the adapter needs from the mounted plugin. */
export interface NeuralwattAdapterOptions {
  /** Human-readable provider label. */
  displayName: string
  /** API root, without a trailing slash. */
  baseURL: string
  /** Model catalog. */
  catalog: Catalog
  /** Overall request deadline in milliseconds. */
  timeoutMs: number
  /** Whether Neuralwatt's hosted tools stay available (adds no opt-out header when true). */
  hostedTools: boolean
  /** Resolve the API key per request, so a rotated credential reaches the next call. */
  resolveApiKey: (signal?: AbortSignal) => Promise<string>
  /** Mounted attachment store, required only for image requests. */
  attachments: () => AttachmentStore | undefined
  /** Plugin logger. */
  logger: { debug: (message: string) => void; warn: (message: string) => void }
  /** Log energy/cost lines at debug level. */
  logEnergy: boolean
}

/** Read a short, safe excerpt of an error body. */
function excerpt(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 400 ? `${compact.slice(0, 400)}…` : compact
}

/** One route over Neuralwatt's OpenAI-compatible endpoint. */
export class NeuralwattAdapter extends LlmAdapter {
  private readonly stats: AdapterStats = {
    requests: 0,
    failed: 0,
    energyJoules: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  }

  constructor(private readonly options: NeuralwattAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.options.displayName }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.options.catalog.list(provider))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.options.catalog.resolve(provider, model))
  }

  /** Per-process totals for the status tool. */
  snapshot(): AdapterStats {
    return { ...this.stats }
  }

  override async *stream(options: GenerateOptions<string>): AsyncGenerator<StreamChunk> {
    const model = this.options.catalog.get(options.model)
    this.stats.requests += 1
    try {
      const key = await this.options.resolveApiKey(options.signal)
      const images = await this.prepareImages(options, model)
      const body = serialize(options, model, images)
      const response = await this.request(body, key, options.signal)
      yield* this.decode(response.body as ReadableStream<Uint8Array>, options, model)
    } catch (error) {
      this.stats.failed += 1
      throw error
    }
  }

  /** Read request-ready bytes for every retained image occurrence. */
  private async prepareImages(options: GenerateOptions<string>, model: CatalogModel | undefined): Promise<ImageMap> {
    const images = new Map<string, { mediaType: string; base64: string }>()
    const occurrences = options.messages.flatMap(message =>
      message.content.filter(block => block.type === 'image' && block.offloaded !== true))
    if (occurrences.length === 0) return images
    if (model?.input.includes('image') !== true) {
      throw new LlmError(`Neuralwatt model "${options.model}" does not declare image input`, 'UNSUPPORTED_CONTENT')
    }
    const attachments = this.options.attachments()
    if (attachments === undefined) {
      throw new LlmError('Neuralwatt image input requires the mounted attachment service', 'UNSUPPORTED_CONTENT')
    }
    for (const block of occurrences) {
      if (block.type !== 'image') continue
      try {
        const version = await attachments.readImageRequest(
          block.attachment,
          { width: block.attachment.width, height: block.attachment.height, maxBytes: block.attachment.bytes },
          options.signal,
        )
        images.set(block.attachment.attachmentId, {
          mediaType: version.mediaType,
          base64: Buffer.from(version.data).toString('base64'),
        })
      } catch (error) {
        throw new LlmError('Neuralwatt could not read a request image', 'UNSUPPORTED_CONTENT', { cause: error })
      }
    }
    return images
  }

  /** POST the serialized request and map transport and HTTP failures. */
  private async request(
    body: Record<string, unknown>,
    key: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const url = `${this.options.baseURL.replace(/\/+$/, '')}/chat/completions`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          ...attributionHeaders(),
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          'authorization': `Bearer ${key}`,
          ...this.options.hostedTools ? {} : { 'x-nw-tools-opt-out': 'true' },
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (signal?.aborted === true) throw new LlmError('Neuralwatt request aborted', 'ABORTED', { cause: error })
      if (timeout.aborted) throw new LlmError(`Neuralwatt request exceeded ${this.options.timeoutMs} ms`, 'TIMEOUT', { cause: error })
      throw new LlmError('Neuralwatt transport failed', 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw providerError(text.length > 0 ? safeJson(text) ?? { message: excerpt(text) } : undefined, response.status)
    }
    if (response.body === null) throw new LlmError('Neuralwatt returned no response body', 'EMPTY_RESPONSE')
    return response
  }

  /** Translate one SSE response into harness chunks, in protocol order. */
  private async *decode(
    body: ReadableStream<Uint8Array>,
    options: GenerateOptions<string>,
    model: CatalogModel | undefined,
  ): AsyncGenerator<StreamChunk> {
    const blocks = new BlockBuilder()
    const telemetry = createTelemetry()
    const queue: QueueTracker = { sawContent: false }
    let usage: ReturnType<typeof mapUsage>
    let finishReason: string | undefined
    try {
      for await (const event of parseSse(body)) {
        if (event.comment !== undefined) {
          captureComment(event.comment, telemetry)
          continue
        }
        const payload = event.data
        if (payload === undefined) continue
        if (payload === '[DONE]') break
        captureQueue(payload, telemetry, queue)
        let frame: Record<string, any>
        try {
          frame = JSON.parse(payload) as Record<string, any>
        } catch (_invalidJson) {
          throw new LlmError('Neuralwatt SSE contains invalid JSON', 'MALFORMED_RESPONSE')
        }
        if (frame.error !== undefined && frame.error !== null) throw providerError(frame)
        if (frame.usage !== undefined) usage = mapUsage(frame.usage)
        const choice = Array.isArray(frame.choices) ? frame.choices[0] : undefined
        if (choice === undefined) continue
        const delta = choice.delta ?? {}
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          for (const chunk of blocks.pushReasoning(reasoning)) yield chunk
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          for (const chunk of blocks.pushText(delta.content)) yield chunk
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            for (const chunk of blocks.pushToolCall(call as { index?: number; id?: string; function?: { name?: string; arguments?: string } })) yield chunk
          }
        }
        if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
      }
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (options.signal?.aborted === true) throw new LlmError('Neuralwatt request aborted', 'ABORTED', { cause: error })
      throw new LlmError('Neuralwatt stream failed', 'TRANSPORT', { cause: error })
    }

    for (const chunk of blocks.finish()) yield chunk
    if (usage !== undefined) {
      yield { type: 'usage', usage }
      this.stats.inputTokens += usage.inputTokens
      this.stats.outputTokens += usage.outputTokens
    }
    yield mapFinish(finishReason, blocks.hasToolCalls())
    this.recordTelemetry(telemetry, options)
  }

  /** Fold one response's energy accounting into process totals and the log. */
  private recordTelemetry(telemetry: EnergyTelemetry, options: GenerateOptions<string>): void {
    this.stats.energyJoules += telemetry.energyJoules
    this.stats.costUsd += telemetry.costUsd
    if (telemetry.queueSeconds !== undefined) this.stats.lastQueueSeconds = telemetry.queueSeconds
    if (!this.options.logEnergy) return
    if (telemetry.energyJoules === 0 && telemetry.costUsd === 0 && telemetry.queueSeconds === undefined) return
    const parts = [
      `model=${options.model}`,
      `energy=${telemetry.energyJoules.toFixed(1)}J`,
      `cost=$${telemetry.costUsd.toFixed(6)}`,
      ...telemetry.queueSeconds === undefined ? [] : [`queue=${telemetry.queueSeconds.toFixed(1)}s`],
    ]
    this.options.logger.debug(`neuralwatt: ${parts.join(' ')}`)
  }
}

/** Parse a JSON error body, returning `undefined` when it is not JSON. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (_notJson) {
    return undefined
  }
}
