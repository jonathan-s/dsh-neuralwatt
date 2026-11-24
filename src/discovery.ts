/**
 * Answering "which models can this route serve?" for the configuration
 * surface's model-discovery action.
 *
 * A route this adapter ships is answered from its own catalog with no network
 * call — that registry carries the context windows and output caps a listing
 * endpoint does not disclose. Only a draft route the adapter does not describe
 * is interrogated over the wire at `GET {baseURL}/models`, the OpenAI-compatible
 * listing Neuralwatt serves. Nothing here is stored: the reply is candidate
 * metadata a surface may offer for adoption.
 *
 * @module dsh-neuralwatt-provider/discovery
 */
import { LlmError, attributionHeaders, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import type { Catalog } from './catalog.js'
import { ROUTE } from './routes.js'

/** Largest model-listing reply accepted; an endpoint is a caller-supplied URL. */
export const MAX_DISCOVERY_BYTES = 4 * 1024 * 1024

/** One exact-path name for the route this adapter registers. */
export { ROUTE }

/** Requested model-list path, appended to the configured endpoint root. */
const MODELS_PATH = '/models'

/** One entry of a compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  name?: unknown
  display_name?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  maxTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  limit?: { context?: unknown; output?: unknown } | null
}

/** First positive integer among the candidates. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** First non-empty string among the candidates. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/** Read either the standard `data` array or an enriched `models` map. */
export function parseModelListing(body: unknown): LlmDiscoveredModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const rows: { key?: string; raw: unknown }[] = []
  if (Array.isArray(listing?.data)) {
    for (const raw of listing.data) rows.push({ raw })
  } else if (listing?.models !== null && typeof listing?.models === 'object' && !Array.isArray(listing.models)) {
    for (const [key, raw] of Object.entries(listing.models as Record<string, unknown>)) {
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) rows.push({ key, raw })
    }
  } else {
    throw new LlmError(
      'the endpoint\'s model listing has neither a "data" array nor a "models" object',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const { key, raw } of rows) {
    const entry = (raw ?? {}) as ListingEntry
    const id = label(key, entry.id)
    if (id === undefined) continue
    const contextWindow = capacity(entry.contextWindow, entry.context_window, entry.context_length, entry.limit?.context)
    const maxTokens = capacity(entry.maxTokens, entry.max_tokens, entry.max_output_tokens, entry.limit?.output)
    models.push({
      id,
      name: label(entry.name, entry.display_name) ?? id,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Read one listing reply, refusing bytes beyond the ceiling.
 * @param response - provider reply.
 * @param url - URL named in diagnostics.
 * @returns the decoded body text.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_DISCOVERY_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_BYTES) throw oversized()
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DISCOVERY_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {
      // Cancel after a drained or abandoned read is cleanup; the reply is already decided.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Interrogate one draft endpoint, or answer from the shipped catalog.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param catalog - the route's own model registry.
 * @returns advertised models in endpoint order.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  catalog: Catalog,
): Promise<readonly LlmDiscoveredModel[]> {
  if (request.provider === ROUTE) return catalog.discover(ROUTE)
  const baseURL = (request.baseURL ?? '').replace(/\/+$/, '')
  if (baseURL.length === 0) {
    throw new LlmError(
      `${ROUTE}: model discovery needs a baseURL for a route the shipped catalog does not describe`,
      'DISCOVERY_FAILED',
    )
  }
  const url = `${baseURL}${MODELS_PATH}`
  const headers = new Headers({ accept: 'application/json' })
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
  if (request.apiKey !== undefined && request.apiKey.length > 0) {
    const checked = normalizeApiKey(request.apiKey)
    if (!checked.ok) {
      throw new LlmError(
        checked.reason === 'empty'
          ? `${ROUTE}: the discovery API key is blank`
          : `${ROUTE}: the discovery API key contains characters no HTTP header can carry`,
        'INVALID_CREDENTIAL',
      )
    }
    headers.set('authorization', `Bearer ${checked.value}`)
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error) {
    if (request.signal?.aborted === true) throw new LlmError(`${ROUTE}: model discovery aborted`, 'ABORTED', { cause: error })
    throw new LlmError(`${ROUTE}: could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error) {
    if (request.signal?.aborted === true) throw new LlmError(`${ROUTE}: model discovery aborted`, 'ABORTED', { cause: error })
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return parseModelListing(body)
}
