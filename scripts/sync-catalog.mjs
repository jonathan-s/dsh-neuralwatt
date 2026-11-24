#!/usr/bin/env node
/**
 * Regenerate src/catalog.generated.ts from the upstream pi-neuralwatt-provider
 * catalogs. Upstream keeps three files: models.json (published catalog),
 * custom-models.json (MCR/long-context additions) and patch.json (per-model
 * corrections). This script applies the same layering the pi extension applies,
 * then projects every chat model onto the fields a DSH route declares.
 *
 * Usage:
 *   node scripts/sync-catalog.mjs [path-to-pi-neuralwatt-provider]
 *
 * The default path is the librarian checkout of the upstream repository. Pass
 * `--fetch` to download the three files from GitHub instead.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const UPSTREAM_RAW = 'https://raw.githubusercontent.com/monotykamary/pi-neuralwatt-provider/main'
const DEFAULT_CHECKOUT = join(homedir(), '.cache/checkouts/github.com/monotykamary/pi-neuralwatt-provider')
const OUTPUT = new URL('../src/catalog.generated.ts', import.meta.url)

const args = process.argv.slice(2)
const fetchMode = args.includes('--fetch')
const checkout = args.find(arg => !arg.startsWith('--')) ?? DEFAULT_CHECKOUT

/** Read one upstream JSON file, locally or over HTTPS. */
async function readJson(name) {
  if (fetchMode) {
    const response = await fetch(`${UPSTREAM_RAW}/${name}`, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`GET ${name}: HTTP ${response.status}`)
    return response.json()
  }
  return JSON.parse(await readFile(join(checkout, name), 'utf8'))
}

/** Per-model patch semantics upstream uses: shallow object merge for nested maps. */
function applyPatch(model, patch) {
  if (patch === undefined) return model
  const merged = { ...model }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(model[key] ?? {}), ...value }
      : value
  }
  return merged
}

/** Thinking levels in DSH's ascending selector order. */
const LEVEL_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Project a pi thinkingLevelMap onto the DSH effort list. A null or absent
 * entry means the level is not selectable; a string is the wire spelling.
 */
function effortsOf(model) {
  if (model.reasoning !== true) return undefined
  const map = model.thinkingLevelMap ?? {}
  const efforts = []
  for (const level of LEVEL_ORDER) {
    const wire = map[level]
    if (typeof wire !== 'string') continue
    efforts.push({ id: level, wire })
  }
  // A reasoning model with no declared map still reasons; let the endpoint's
  // own default decide by exposing no selector rather than inventing levels.
  return efforts.length > 0 ? efforts : undefined
}

/** Compat switches this adapter implements, copied only when upstream sets them. */
function compatOf(model) {
  const source = model.compat ?? {}
  const compat = {}
  if (source.supportsReasoningEffort !== undefined) compat.supportsReasoningEffort = source.supportsReasoningEffort
  if (source.requiresReasoningContentOnAssistantMessages !== undefined) {
    compat.requiresReasoningContentOnAssistantMessages = source.requiresReasoningContentOnAssistantMessages
  }
  if (source.supportsDeveloperRole !== undefined) compat.supportsDeveloperRole = source.supportsDeveloperRole
  if (source.thinkingFormat !== undefined) compat.thinkingFormat = source.thinkingFormat
  if (source.requiresThinkingAsText !== undefined) compat.requiresThinkingAsText = source.requiresThinkingAsText
  if (model.compat?.thinkingFormat === 'qwen-chat-template' || model.compat?.thinkingFormat === 'chat-template') {
    compat.thinkingFormat = 'chat-template'
  }
  return Object.keys(compat).length > 0 ? compat : undefined
}

const published = await readJson('models.json')
const custom = await readJson('custom-models.json')
const patches = await readJson('patch.json')

const byId = new Map()
for (const model of [...published, ...custom]) {
  if (model.type === 'classifier') continue
  // Upstream prefixes MCR ids with the provider name; a DSH route already
  // namespaces the provider, so the wire id drops the prefix.
  const id = String(model.id).replace(/^neuralwatt\//, '')
  byId.set(id, { ...model, id })
}
for (const [id, patch] of Object.entries(patches)) {
  const base = byId.get(id)
  if (base === undefined) continue
  byId.set(id, applyPatch(base, patch))
}

const models = [...byId.values()].map((model) => {
  const input = Array.isArray(model.input) && model.input.includes('image') ? ['text', 'image'] : ['text']
  const efforts = effortsOf(model)
  const compat = compatOf(model)
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input,
    ...(efforts === undefined ? {} : { efforts }),
    ...(compat === undefined ? {} : { compat }),
    ...(model.cost === undefined ? {} : { cost: model.cost }),
  }
}).sort((left, right) => left.name.localeCompare(right.name))

const banner = `// Generated by scripts/sync-catalog.mjs — do not edit by hand.
// Source: github.com/monotykamary/pi-neuralwatt-provider (models.json,
// custom-models.json, patch.json). Regenerate with \`npm run sync-catalog\`.
/* eslint-disable */
import type { CatalogModel } from './catalog.js'

export const NEURALWATT_MODELS: readonly CatalogModel[] = ${JSON.stringify(models, null, 2)}
`

await writeFile(OUTPUT, banner)
console.log(`wrote ${models.length} models to ${OUTPUT.pathname}`)
for (const model of models) {
  console.log(`  ${model.id.padEnd(28)} ${String(model.contextWindow).padStart(8)} ctx  ${model.input.join('+')}  ${model.efforts?.map(effort => effort.id).join(',') ?? 'no-reasoning'}`)
}
