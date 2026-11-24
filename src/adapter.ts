/**
 * The Neuralwatt adapter: one route (`neuralwatt`) over the OpenAI-compatible
 * Chat Completions endpoint, with vision, reasoning efforts, tool calls, and
 * durable energy telemetry.
 *
 * The route reads its settings per request, so a configuration write reaches
 * the next call without a restart. It declares the image projection it actually
 * sends and leaves image token pricing to the harness's neutral estimate, because
 * the endpoint publishes no visual-token formula; it does not retry — that is
 * `dsh-llm-retry`'s job, driven by the provider retry policy and the failure
 * codes below.
 *
 * @module dsh-neuralwatt-provider/adapter
 */
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { deadline, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { Catalog } from './catalog.js'
import type { CatalogModel } from './catalog.js'
import { captureComment, captureQueue, createTelemetry } from './energy.js'
import type { QueueTracker } from './energy.js'
import { resolveRequestImageTarget } from './images.js'
import type { ResolvedOptions } from './options.js'
import { replayEnvelope } from './replay.js'
import type { ResponseTelemetry } from './replay.js'
import { BlockBuilder, mapFinish, mapUsage, parseSse, providerError, serialize } from './wire.js'
import type { ImageMap } from './wire.js'

/** Everything the adapter needs from the mounted plugin. */
export interface AdapterDependencies {
  /** Current resolved settings; called once per request so writes apply eagerly. */
  options: () => ResolvedOptions
  /** Model catalog. */
  catalog: Catalog
  /** Resolve the API key per request, so a rotated credential reaches the next call. */
  resolveApiKey: (signal?: AbortSignal) => Promise<string>
  /** Mounted attachment store, required only for image requests. */
  attachments: () => AttachmentStore | undefined
  /** Plugin logger. */
  logger: { debug: (message: string) => void; warn: (message: string) => void }
}

/** One route over Neuralwatt's OpenAI-compatible endpoint. */
export class NeuralwattAdapter extends LlmAdapter {
  constructor(private readonly dependencies: AdapterDependencies) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.dependencies.options().displayName }
  }

  override providerRetryPolicy(_provider: string) {
    return this.dependencies.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.dependencies.catalog.list(provider))
  }

  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.dependencies.catalog.resolve(provider, model))
  }

  /**
   * The request-image projection this adapter sends: the same aspect ratio,
   * bounded by the pixel budget and encoded-byte target. The endpoint bills
   * images as ordinary input tokens it does not disclose, so no provider-side
   * token price is declared.
   */
  override imageRequestTarget(_provider: string, _model: string, image: ImageAttachmentRef) {
    return resolveRequestImageTarget(image)
  }

  override async *stream(options: GenerateOptions<string>): AsyncGenerator<StreamChunk> {
    const live = this.dependencies.options()
    const model = this.dependencies.catalog.get(options.model)
    using requestDeadline = deadline(options.signal, live.requestTimeoutMs, 'NEURALWATT_REQUEST')
    using watchdog = idleWatchdog(requestDeadline.signal, live.idleTimeoutMs, 'NEURALWATT_IDLE')
    try {
      const key = await this.dependencies.resolveApiKey(watchdog.signal)
      const images = await this.prepareImages(options, watchdog.signal)
      const body = serialize(options, model, images)
      const response = await this.request(body, key, live, watchdog.signal)
      yield* this.decode(response.body as ReadableStream<Uint8Array>, options, watchdog, live)
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (timeoutOf(watchdog.signal, 'NEURALWATT_IDLE') !== undefined) {
        throw new LlmError(`Neuralwatt stream was idle for ${live.idleTimeoutMs} ms`, 'TIMEOUT', { cause: error })
      }
      if (timeoutOf(requestDeadline.signal, 'NEURALWATT_REQUEST') !== undefined) {
        throw new LlmError(`Neuralwatt request exceeded ${live.requestTimeoutMs} ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted === true) {
        throw new LlmError('Neuralwatt request aborted', 'ABORTED', { cause: error })
      }
      throw new LlmError('Neuralwatt transport failed', 'TRANSPORT', { cause: error })
    }
  }

  /** Read request-ready bytes for every retained image occurrence. */
  private async prepareImages(options: GenerateOptions<string>, signal: AbortSignal): Promise<ImageMap> {
    const images = new Map<string, { mediaType: string; base64: string }>()
    const occurrences = options.messages.flatMap(message =>
      message.content.filter(block => block.type === 'image' && block.offloaded !== true))
    if (occurrences.length === 0) return images
    const attachments = this.dependencies.attachments()
    if (attachments === undefined) {
      throw new LlmError('Neuralwatt image input requires the mounted attachment service', 'UNSUPPORTED_CONTENT')
    }
    for (const block of occurrences) {
      if (block.type !== 'image') continue
      if (images.has(block.attachment.attachmentId)) continue
      let version
      try {
        version = await attachments.readImageRequest(
          block.attachment,
          resolveRequestImageTarget(block.attachment),
          signal,
        )
      } catch (error) {
        throw new LlmError('Neuralwatt could not read a request image', 'UNSUPPORTED_CONTENT', { cause: error })
      }
      images.set(block.attachment.attachmentId, {
        mediaType: version.mediaType,
        base64: Buffer.from(version.data).toString('base64'),
      })
    }
    return images
  }

  /** POST the serialized request and map transport and HTTP failures. */
  private async request(
    body: Record<string, unknown>,
    key: string,
    live: ResolvedOptions,
    signal: AbortSignal,
  ): Promise<Response> {
    const url = `${live.baseURL}/chat/completions`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          ...attributionHeaders(),
          'content-type': 'application/json',
          'accept': 'text/event-stream',
          'authorization': `Bearer ${key}`,
          ...live.hostedTools ? {} : { 'x-nw-tools-opt-out': 'true' },
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new LlmError('Neuralwatt transport failed', 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const parsed = parseErrorBody(text)
      throw providerError(parsed, response.status, response.headers)
    }
    if (response.body === null) throw new LlmError('Neuralwatt returned no response body', 'EMPTY_RESPONSE')
    return response
  }

  /** Translate one SSE response into harness chunks, in protocol order. */
  private async *decode(
    body: ReadableStream<Uint8Array>,
    options: GenerateOptions<string>,
    watchdog: ReturnType<typeof idleWatchdog>,
    live: ResolvedOptions,
  ): AsyncGenerator<StreamChunk> {
    const blocks = new BlockBuilder()
    const telemetry = createTelemetry()
    const queue: QueueTracker = { sawContent: false }
    let usage: ReturnType<typeof mapUsage>
    let finishReason: string | undefined
    const iterator = parseSse(body)[Symbol.asyncIterator]()
    try {
    for (;;) {
      const next = await watchdog.next(iterator)
      if (next.done) break
      const event = next.value
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
    } finally {
      // Release the response stream even when the consumer stopped early.
      void Promise.resolve(iterator.return?.(undefined)).catch(() => {})
    }

    if (finishReason === 'content_filter') {
      throw new LlmError('Neuralwatt refused the response because of its content policy', 'CONTENT_REFUSED')
    }
    // A completion that produced no blocks at all leaves the turn with nothing
    // to act on; the canonical empty-response code is retryable.
    if (!blocks.hasBlocks()) throw new LlmError('Neuralwatt returned an empty response', 'EMPTY_RESPONSE')

    for (const chunk of blocks.finish()) yield chunk
    if (usage !== undefined) yield { type: 'usage', usage }
    const captured: ResponseTelemetry = {
      energyJoules: telemetry.energyJoules,
      costUsd: telemetry.costUsd,
      carbonGrams: telemetry.carbonGrams,
      ...telemetry.queueSeconds === undefined ? {} : { queueSeconds: telemetry.queueSeconds },
      ...telemetry.gridId === undefined ? {} : { gridId: telemetry.gridId },
      ...telemetry.gridIntensityGco2PerKwh === undefined ? {} : { gridIntensityGco2PerKwh: telemetry.gridIntensityGco2PerKwh },
      ...telemetry.carbonSource === undefined ? {} : { carbonSource: telemetry.carbonSource },
    }
    if (live.logEnergy
      && (captured.energyJoules > 0 || captured.costUsd > 0 || (captured.carbonGrams ?? 0) > 0 || captured.queueSeconds !== undefined)) {
      const parts = [
        `model=${options.model}`,
        `energy=${captured.energyJoules.toFixed(1)}J`,
        `cost=$${captured.costUsd.toFixed(6)}`,
        `carbon=${(captured.carbonGrams ?? 0).toFixed(4)}g`,
        ...captured.gridId === undefined ? [] : [`grid=${captured.gridId}`],
        ...captured.queueSeconds === undefined ? [] : [`queue=${captured.queueSeconds.toFixed(1)}s`],
      ]
      this.dependencies.logger.debug(`neuralwatt: ${parts.join(' ')}`)
    }
    const terminal = mapFinish(finishReason, blocks.hasToolCalls())
    yield {
      type: 'finish',
      reason: terminal.reason,
      replayState: replayEnvelope(options.model, blocks.blockTypes(), captured),
    }
  }
}

/** Parse a provider error body, falling back to its text excerpt. */
function parseErrorBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch (_notJson) {
    return { message: text.replace(/\s+/g, ' ').trim().slice(0, 400) }
  }
}
