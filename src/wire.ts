/**
 * Wire layer for Neuralwatt's OpenAI-compatible Chat Completions endpoint:
 * provider-neutral harness messages to a JSON request body, and SSE frames back
 * to harness `StreamChunk` values.
 *
 * @module dsh-neuralwatt-provider/wire
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { Catalog, CatalogModel } from './catalog.js'

/** One request-ready image, already encoded by the attachment service. */
export interface WireImage {
  mediaType: string
  base64: string
}

/** Request images keyed by durable attachment id. */
export type ImageMap = ReadonlyMap<string, WireImage>

/** One OpenAI Chat Completions message. */
interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | WirePart[]
  tool_calls?: WireToolCall[]
  tool_call_id?: string
  reasoning_content?: string
}

interface WirePart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Text of a message's non-image blocks. */
function textOf(content: readonly ContentBlock[], images: ImageMap): string {
  return content.flatMap((block) => {
    switch (block.type) {
      case 'text': return [block.text]
      case 'image': {
        const image = images.get(block.attachment.attachmentId)
        return block.offloaded === true || image === undefined
          ? [`[image omitted from the request: ${block.attachment.name ?? block.attachment.mediaType}]`]
          : []
      }
      case 'file': return [`[file ${block.attachment.name}, ${block.attachment.bytes} bytes — read it with the file tools]`]
      default: return []
    }
  }).filter(text => text.length > 0).join('\n')
}

/** User/tool content as multipart parts when it carries images, otherwise a string. */
function userContent(content: readonly ContentBlock[], images: ImageMap): string | WirePart[] {
  const parts: WirePart[] = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const image = images.get(block.attachment.attachmentId)
      if (block.offloaded === true || image === undefined) {
        parts.push({ type: 'text', text: `[image omitted from the request: ${block.attachment.name ?? block.attachment.mediaType}]` })
        continue
      }
      parts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } })
      continue
    }
    if (block.type === 'file') {
      parts.push({ type: 'text', text: `[file ${block.attachment.name}, ${block.attachment.bytes} bytes — read it with the file tools]` })
    }
  }
  return parts.every(part => part.type === 'text') ? parts.map(part => part.text ?? '').join('\n') : parts
}

/** Assistant history, replaying preserved thinking only where the endpoint reads it. */
function assistantMessage(message: RequestMessage, images: ImageMap, compat: CatalogModel['compat']): WireMessage {
  const content = message.content
  const text = content.filter(block => block.type === 'text').map(block => block.text).join('')
  const calls = content.filter(block => block.type === 'tool-call').map(block => ({
    id: block.id,
    type: 'function' as const,
    function: { name: block.name, arguments: block.arguments.length > 0 ? block.arguments : '{}' },
  }))
  const reasoning = content.filter(block => block.type === 'reasoning').map(block => block.text).join('')
  void images
  return {
    role: 'assistant',
    content: text.length > 0 ? text : null,
    ...calls.length === 0 ? {} : { tool_calls: calls },
    ...compat?.requiresReasoningContentOnAssistantMessages === true && reasoning.length > 0
      ? { reasoning_content: reasoning }
      : {},
  }
}

/**
 * Serialize one harness request into the endpoint's JSON body.
 * @param options - provider-neutral request, already projected by the LLM service.
 * @param model - the catalog entry for `options.model`, when known.
 * @param images - request-ready image bytes keyed by attachment id.
 * @returns the JSON body for `POST {baseURL}/chat/completions`.
 */
export function serialize(
  options: GenerateOptions<string>,
  model: CatalogModel | undefined,
  images: ImageMap,
): Record<string, unknown> {
  const compat = model?.compat
  const messages: WireMessage[] = []
  for (const message of options.messages) {
    switch (message.role) {
      case 'system':
        messages.push({ role: 'system', content: textOf(message.content, images) })
        break
      case 'developer':
        messages.push({ role: 'system', content: textOf(message.content, images) })
        break
      case 'user':
        messages.push({ role: 'user', content: userContent(message.content, images) })
        break
      case 'assistant':
        messages.push(assistantMessage(message, images, compat))
        break
      case 'tool': {
        const text = textOf(message.content, images)
        messages.push({
          role: 'tool',
          tool_call_id: String(message.toolCallId),
          content: message.isError === true && text.length === 0 ? 'Tool failed.' : text,
        })
        break
      }
    }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    stream: true,
  }
  if (compat?.supportsUsageInStreaming !== false) body.stream_options = { include_usage: true }
  if (options.maxTokens !== undefined) body[compat?.maxTokensField ?? 'max_tokens'] = options.maxTokens
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined && options.stop.length > 0) body.stop = options.stop
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  }

  const effort = options.reasoningEffort as string | undefined
  const wire = model === undefined ? null : new Map(model.efforts?.map(level => [level.id, level.wire])).get(effort ?? '')
  if (effort !== undefined && compat?.supportsReasoningEffort !== false && typeof wire === 'string') {
    body.reasoning_effort = wire
  }
  if (compat?.thinkingFormat === 'chat-template') {
    // Qwen-family endpoints express thinking as a chat-template switch rather
    // than a named effort; `off` is the only level that disables it.
    body.chat_template_kwargs = { enable_thinking: effort !== 'off' }
  }
  return body
}

/** One parsed SSE frame: either a `data:` payload or a colon-prefixed comment. */
export interface SseEvent {
  data?: string
  comment?: string
}

/**
 * Decode SSE framing incrementally, preserving comment frames (Neuralwatt
 * reports energy and billed cost as `: energy {...}` / `: cost {...}`).
 * @param body - response bytes.
 * @returns frames in arrival order, including the `[DONE]` sentinel.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          if (data.length > 0) {
            const payload = data.join('\n')
            data = []
            yield { data: payload }
          }
        } else if (line.startsWith(':')) {
          yield { comment: line.slice(1).trim() }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
        newline = buffer.indexOf('\n')
      }
      if (done) break
    }
    const tail = buffer.trim()
    if (tail.startsWith('data:')) data.push(tail.slice(5).replace(/^ /, ''))
    else if (tail.startsWith(':')) yield { comment: tail.slice(1).trim() }
    if (data.length > 0) yield { data: data.join('\n') }
  } finally {
    reader.releaseLock()
  }
}

/** Accumulates one response's blocks and emits the harness chunk protocol. */
export class BlockBuilder {
  private nextIndex = 0
  private text: { index: number; parts: string[] } | undefined
  private reasoning: { index: number; parts: string[] } | undefined
  private readonly calls = new Map<number, { index: number; id: string; name: string; args: string }>()

  /** Start the visible-text block on first use, then stream its delta. */
  pushText(delta: string): StreamChunk[] {
    const chunks: StreamChunk[] = []
    if (this.text === undefined) {
      this.text = { index: this.nextIndex++, parts: [] }
      chunks.push({ type: 'block-start', index: this.text.index, blockType: 'text' })
    }
    this.text.parts.push(delta)
    chunks.push({ type: 'text-delta', index: this.text.index, text: delta })
    return chunks
  }

  /** Start the reasoning block on first use, then stream its delta. */
  pushReasoning(delta: string): StreamChunk[] {
    const chunks: StreamChunk[] = []
    if (this.reasoning === undefined) {
      this.reasoning = { index: this.nextIndex++, parts: [] }
      chunks.push({ type: 'block-start', index: this.reasoning.index, blockType: 'reasoning' })
    }
    this.reasoning.parts.push(delta)
    chunks.push({ type: 'reasoning-delta', index: this.reasoning.index, text: delta })
    return chunks
  }

  /** Append one OpenAI tool-call delta, opening its block on first sight. */
  pushToolCall(delta: { index?: number; id?: string; function?: { name?: string; arguments?: string } }): StreamChunk[] {
    const key = delta.index ?? 0
    const chunks: StreamChunk[] = []
    let call = this.calls.get(key)
    if (call === undefined) {
      call = { index: this.nextIndex++, id: delta.id ?? `call_${key}`, name: '', args: '' }
      this.calls.set(key, call)
      chunks.push({ type: 'block-start', index: call.index, blockType: 'tool-call' })
    } else if (delta.id !== undefined && delta.id.length > 0) {
      call.id = delta.id
    }
    const name = delta.function?.name
    if (name !== undefined && name.length > 0) call.name += name
    const argumentsDelta = delta.function?.arguments ?? ''
    call.args += argumentsDelta
    chunks.push({
      type: 'tool-call-delta',
      index: call.index,
      id: call.id as ToolCallId,
      ...name === undefined || name.length === 0 ? {} : { name },
      argumentsDelta,
    })
    return chunks
  }

  /** Whether the model produced at least one tool call. */
  hasToolCalls(): boolean {
    return this.calls.size > 0
  }

  /** Close every open block in emission (index) order. */
  finish(): StreamChunk[] {
    const chunks: StreamChunk[] = []
    type Open =
      | { index: number; kind: 'text'; parts: string[] }
      | { index: number; kind: 'reasoning'; parts: string[] }
      | { index: number; kind: 'tool-call'; call: { id: string; name: string; args: string } }
    const open: Open[] = []
    if (this.text !== undefined) open.push({ index: this.text.index, kind: 'text', parts: this.text.parts })
    if (this.reasoning !== undefined) open.push({ index: this.reasoning.index, kind: 'reasoning', parts: this.reasoning.parts })
    for (const call of this.calls.values()) open.push({ index: call.index, kind: 'tool-call', call })
    open.sort((left, right) => left.index - right.index)
    for (const block of open) {
      if (block.kind === 'text') {
        chunks.push({ type: 'block-end', index: block.index, block: { type: 'text', text: block.parts.join('') } })
      } else if (block.kind === 'reasoning') {
        chunks.push({ type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.parts.join('') } })
      } else {
        chunks.push({
          type: 'block-end',
          index: block.index,
          block: {
            type: 'tool-call',
            id: block.call.id as ToolCallId,
            name: block.call.name.length > 0 ? block.call.name : 'unknown_tool',
            arguments: block.call.args.length > 0 ? block.call.args : '{}',
          },
        })
      }
    }
    return chunks
  }
}

/** Map provider usage onto the harness's disjoint token counters. */
export function mapUsage(raw: unknown): TokenUsage | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const usage = raw as Record<string, any>
  const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined
  const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined
  if (prompt === undefined && completion === undefined) return undefined
  const cached = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const cachedTokens = typeof cached === 'number' && cached > 0 ? cached : undefined
  return {
    inputTokens: Math.max(0, (prompt ?? 0) - (cachedTokens ?? 0)),
    outputTokens: completion ?? 0,
    totalTokens: prompt !== undefined && completion !== undefined ? prompt + completion : undefined,
    ...cachedTokens === undefined ? {} : { cacheReadTokens: cachedTokens },
    ...typeof reasoning === 'number' && reasoning > 0 ? { reasoningTokens: reasoning } : {},
  }
}

/** Map an OpenAI finish reason onto the harness's terminal reason. */
export function mapFinish(reason: string | undefined, hasToolCalls: boolean): StreamChunk {
  if (reason === 'length') return { type: 'finish', reason: { kind: 'max-tokens' } }
  if (hasToolCalls || reason === 'tool_calls' || reason === 'function_call') {
    return { type: 'finish', reason: { kind: 'tool-calls' } }
  }
  return { type: 'finish', reason: { kind: 'stop' } }
}

/** Provider error payload to a typed harness failure. */
export function providerError(payload: unknown, status?: number): LlmError {
  const detail = payload !== null && typeof payload === 'object'
    ? (payload as Record<string, any>).error ?? payload
    : undefined
  const message = detail !== null && typeof detail === 'object'
    ? String((detail as Record<string, any>).message ?? JSON.stringify(detail))
    : typeof detail === 'string' ? detail : 'Neuralwatt API request failed'
  return LlmError.fromFailure({
    message: `Neuralwatt: ${message}`,
    code: typeof (detail as any)?.code === 'string' ? (detail as any).code : 'PROVIDER_HTTP_ERROR',
    ...status === undefined ? {} : { status },
  })
}
