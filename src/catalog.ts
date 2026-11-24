/**
 * Neuralwatt model catalog: the checked-in projection of the upstream
 * pi-neuralwatt-provider catalogs plus the DSH-facing lookups an adapter owes
 * the LLM service (`listModels`, `resolveModel`, and catalog-backed discovery).
 *
 * @module dsh-neuralwatt-provider/catalog
 */
import type {
  LlmDiscoveredModel,
  LlmModelBadge,
  LlmModelInfo,
  LlmResolvedModelInfo,
  ModelModality,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import { NEURALWATT_MODELS } from './catalog.generated.js'

/** Wire-compatibility switches this adapter implements for a model. */
export interface CatalogCompat {
  /** Whether the endpoint accepts `reasoning_effort`. */
  supportsReasoningEffort?: boolean
  /** Whether replayed assistant messages need an empty `reasoning_content` while reasoning is on. */
  requiresReasoningContentOnAssistantMessages?: boolean
  /** Whether the endpoint accepts the `developer` role; the adapter always sends `system`. */
  supportsDeveloperRole?: boolean
  /** Whether `stream_options.include_usage` is accepted. */
  supportsUsageInStreaming?: boolean
  /** Which output-cap field the endpoint reads. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /** Thinking dialect; `chat-template` sends `chat_template_kwargs.enable_thinking`. */
  thinkingFormat?: 'chat-template' | 'deepseek' | 'openai'
  /** Whether thinking must travel as `<thinking>` text. */
  requiresThinkingAsText?: boolean
}

/** Per-million-token list prices, kept for model descriptions. */
export interface CatalogCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One selectable reasoning level and the wire spelling it dispatches. */
export interface CatalogEffort {
  /** Selector id (`off`, `low`, …). */
  id: string
  /** Exact value sent in `reasoning_effort`, or `undefined` to send nothing. */
  wire?: string
}

/** One model as the generated catalog records it. */
export interface CatalogModel {
  /** Model id sent to the provider. */
  id: string
  /** Display name for selectors. */
  name: string
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
  /** Maximum output tokens; also the per-request default cap. */
  maxTokens: number
  /** Accepted request modalities. */
  input: readonly ModelModality[]
  /** Selectable reasoning efforts, least to greatest; absent means no selector. */
  efforts?: readonly CatalogEffort[]
  /** Wire switches the endpoint needs. */
  compat?: CatalogCompat
  /** List prices per million tokens. */
  cost?: CatalogCost
}

/** Selector display names for DSH's reasoning levels. */
const EFFORT_NAMES: Record<string, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** DSH-branded effort id for one catalog level. */
function effortId(id: string): ReasoningEffortId {
  return id as ReasoningEffortId
}

/** Compact context capacity for a selector description. */
function contextLabel(tokens: number): string {
  return tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M context`
    : `${Math.round(tokens / 1_000)}K context`
}

/** Compact list price for a selector description. */
function priceLabel(cost: CatalogCost): string {
  const money = (value: number): string => `$${Number(value.toFixed(4))}`
  return `${money(cost.input)}/M in · ${money(cost.output)}/M out`
}

/**
 * One user-facing distinction shown beside the model name.
 *
 * A flex-tier model queues server-side and bills at a different rate, which is
 * exactly the fact a user needs before selecting it; the tone stays neutral
 * because a flex tier is a tradeoff, not a recommendation.
 */
function badgeOf(model: CatalogModel): LlmModelBadge | undefined {
  return model.id.endsWith('-flex') ? { text: 'Flex', tone: 'neutral' } : undefined
}

/** One-line selector description: price when known, then context capacity. */
function descriptionOf(model: CatalogModel): string {
  const parts = model.cost === undefined ? [] : [priceLabel(model.cost)]
  parts.push(contextLabel(model.contextWindow))
  return parts.join(' · ')
}

/** Read-only catalog with the lookups one route's adapter needs. */
export class Catalog {
  private readonly byId: Map<string, CatalogModel>

  /**
   * @param models - generated model list; later entries with a duplicate id replace earlier ones.
   */
  constructor(models: readonly CatalogModel[] = NEURALWATT_MODELS) {
    this.byId = new Map(models.map(model => [model.id, model]))
  }

  /** Every model the route advertises, in display order. */
  list(provider: string): readonly LlmModelInfo[] {
    return [...this.byId.values()].map((model) => {
      const badge = badgeOf(model)
      return {
        provider,
        id: model.id,
        name: model.name,
        description: descriptionOf(model),
        inputModalities: model.input,
        ...badge === undefined ? {} : { badge },
      }
    })
  }

  /**
   * Model choices this catalog can answer for model discovery, with the
   * capacities a listing endpoint does not disclose.
   */
  discover(_provider: string): readonly LlmDiscoveredModel[] {
    return [...this.byId.values()].map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      inputModalities: [...model.input],
    }))
  }

  /** Metadata for one exact model; an unknown id still routes with neutral defaults. */
  resolve(provider: string, model: string): LlmResolvedModelInfo {
    const entry = this.byId.get(model)
    if (entry === undefined) return { provider, id: model, name: model }
    const badge = badgeOf(entry)
    return {
      provider,
      id: entry.id,
      name: entry.name,
      description: descriptionOf(entry),
      inputModalities: entry.input,
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: entry.maxTokens,
      // OpenAI-compatible Chat Completions reads the latest system message at any
      // position as the effective prompt, so a changed prompt can follow cached
      // history instead of rewriting message 0.
      systemPromptUpdate: 'in-history',
      ...badge === undefined ? {} : { badge },
      ...entry.efforts === undefined
        ? {}
        : {
          reasoning: {
            efforts: entry.efforts.map(effort => ({
              id: effortId(effort.id),
              name: EFFORT_NAMES[effort.id] ?? effort.id,
            })),
          },
        },
    }
  }

  /** The catalog entry, or `undefined` for a model id the catalog does not list. */
  get(model: string): CatalogModel | undefined {
    return this.byId.get(model)
  }

  /** Whether the model accepts images. */
  acceptsImages(model: string): boolean {
    return this.byId.get(model)?.input.includes('image') === true
  }

  /**
   * Wire spelling of one selected effort.
   * @returns the string to send, `null` to send nothing, or `undefined` when the level is unknown.
   */
  effortWire(model: string, effort: string | undefined): string | null | undefined {
    if (effort === undefined) return null
    const entry = this.byId.get(model)
    const level = entry?.efforts?.find(candidate => candidate.id === effort)
    if (level === undefined) return undefined
    return level.wire ?? null
  }
}
