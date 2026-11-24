import test from 'node:test'
import assert from 'node:assert/strict'
import { __internals } from '../lib/index.js'

const {
  Catalog,
  serialize,
  parseSse,
  BlockBuilder,
  mapUsage,
  mapFinish,
  providerError,
  captureComment,
  captureQueue,
  createTelemetry,
  formatEnergy,
  formatCarbon,
  resolveOptions,
  registrationFacts,
  applyUsage,
  usageProjectionDefinition,
  resolveRequestImageTarget,
  parseModelListing,
  readTelemetry,
  replayEnvelope,
} = __internals

/** Build a ReadableStream from string fragments. */
function streamOf(...parts) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

/** One durable assistant message from the neuralwatt route. */
function assistantEvent({ model = 'deepseek-v4.1-flash', replayState, usage, provider = 'neuralwatt' } = {}) {
  return {
    type: 'assistant/message',
    data: {
      message: {
        role: 'assistant',
        source: { kind: 'model', provider, model, ...(replayState === undefined ? {} : { replayState }) },
        content: [{ type: 'text', text: 'hi' }],
      },
      ...(usage === undefined ? {} : { usage }),
    },
  }
}

const MESSAGE = { role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }

test('catalog lists the ported upstream models with selector metadata', () => {
  const catalog = new Catalog()
  const models = catalog.list('neuralwatt')
  assert.ok(models.length >= 20)
  assert.ok(models.every(model => model.provider === 'neuralwatt'))
  assert.ok(models.some(model => model.id === 'deepseek-v4.1-flash'))
  assert.ok(models.some(model => model.id === 'kimi-k3.1-pro'))
  assert.ok(!models.some(model => model.id === 'clef-flash'), 'classifiers must not be chat routes')
  const flash = models.find(model => model.id === 'deepseek-v4.1-flash')
  assert.match(flash.description, /\$0\.15\/M in/)
  assert.match(flash.description, /1M context/)
  const flex = models.find(model => model.id.endsWith('-flex'))
  assert.equal(flex.badge.text, 'Flex')
})

test('catalog resolves context, output cap, modalities, efforts and prompt update', () => {
  const catalog = new Catalog()
  const flash = catalog.resolve('neuralwatt', 'deepseek-v4.1-flash')
  assert.equal(flash.context.contextWindow, 1048560)
  assert.equal(flash.defaultMaxTokens, 393216)
  assert.deepEqual(flash.inputModalities, ['text', 'image'])
  assert.equal(flash.systemPromptUpdate, 'in-history')
  assert.deepEqual(flash.reasoning.efforts.map(effort => effort.id), ['off', 'low', 'high', 'max'])
  assert.equal(catalog.effortWire('deepseek-v4.1-flash', 'off'), 'none')
  assert.equal(catalog.effortWire('deepseek-v4.1-flash', 'medium'), undefined)
  assert.deepEqual(catalog.resolve('neuralwatt', 'glm-5.3').inputModalities, ['text'])
  assert.deepEqual(catalog.resolve('neuralwatt', 'unlisted'), { provider: 'neuralwatt', id: 'unlisted', name: 'unlisted' })
  assert.ok(catalog.discover('neuralwatt').every(model => model.contextWindow > 0))
})

test('serialize maps a one-shot system prompt, images, tools and reasoning effort', () => {
  const body = serialize(
    {
      provider: 'neuralwatt',
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
      maxTokens: 1024,
      temperature: 0.2,
      system: 'be brief',
      messages: [
        {
          role: 'user',
          id: 'u1',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } },
          ],
        },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    },
    new Catalog().get('deepseek-v4.1-flash'),
    new Map([['a1', { mediaType: 'image/png', base64: 'AAAA' }]]),
  )

  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.max_tokens, 1024)
  assert.equal(body.temperature, 0.2)
  assert.equal(body.reasoning_effort, 'high')
  assert.deepEqual(body.messages[0], { role: 'system', content: 'be brief' })
  assert.deepEqual(body.messages[1].content, [
    { type: 'text', text: 'what is this?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ])
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } } }])
})

test('serialize keeps assistant tool calls correlated and replays thinking only to its author', () => {
  const catalog = new Catalog()
  const toolHistory = {
    provider: 'neuralwatt',
    messages: [
      {
        role: 'assistant',
        id: 'a1',
        source: { kind: 'model', provider: 'neuralwatt', model: 'deepseek-v4.1-flash' },
        content: [
          { type: 'reasoning', text: 'thought' },
          { type: 'text', text: 'checking' },
          { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"ls"}' },
        ],
      },
      {
        role: 'tool',
        id: 't1',
        toolCallId: 'call-1',
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'text', text: 'file.txt' }],
      },
    ],
  }
  const sameModel = serialize(
    { provider: 'neuralwatt', model: 'deepseek-v4.1-flash', messages: toolHistory.messages },
    catalog.get('deepseek-v4.1-flash'),
    new Map(),
  )
  assert.equal(sameModel.messages[0].reasoning_content, 'thought')
  assert.deepEqual(sameModel.messages[0].tool_calls, [
    { id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
  ])
  assert.equal(sameModel.messages[1].tool_call_id, 'call-1')
  assert.equal(sameModel.reasoning_effort, undefined)

  const otherModelMessage = {
    ...toolHistory.messages[0],
    source: { kind: 'model', provider: 'neuralwatt', model: 'glm-5.3' },
  }
  const crossModel = serialize(
    { provider: 'neuralwatt', model: 'deepseek-v4.1-flash', messages: [otherModelMessage] },
    catalog.get('deepseek-v4.1-flash'),
    new Map(),
  )
  assert.equal(crossModel.messages[0].reasoning_content, '', 'another model’s thinking must not be replayed')
})

test('serialize sends the qwen chat-template thinking switch', () => {
  const model = { id: 'qwen', name: 'Qwen', contextWindow: 1000, maxTokens: 100, input: ['text'], compat: { thinkingFormat: 'chat-template' } }
  const off = serialize({ provider: 'neuralwatt', model: 'qwen', reasoningEffort: 'off', messages: [] }, model, new Map())
  assert.deepEqual(off.chat_template_kwargs, { enable_thinking: false })
  const high = serialize({ provider: 'neuralwatt', model: 'qwen', reasoningEffort: 'high', messages: [] }, model, new Map())
  assert.deepEqual(high.chat_template_kwargs, { enable_thinking: true })
})

test('parseSse yields comments, multi-line data, and the done sentinel', async () => {
  const events = []
  for await (const event of parseSse(streamOf(': energy {"energy_joules":12.5}\r\n\r\n', 'data: {"a":', '1}\n\n', 'data: [DONE]\n\n'))) {
    events.push(event)
  }
  assert.deepEqual(events, [
    { comment: 'energy {"energy_joules":12.5}' },
    { data: '{"a":1}' },
    { data: '[DONE]' },
  ])
})

test('BlockBuilder emits matched starts, deltas and ends with tool calls', () => {
  const builder = new BlockBuilder()
  const chunks = []
  chunks.push(...builder.pushReasoning('think'))
  chunks.push(...builder.pushText('hello'))
  chunks.push(...builder.pushToolCall({ index: 0, id: 'call-1', function: { name: 'bash', arguments: '{"comm' } }))
  chunks.push(...builder.pushToolCall({ index: 0, function: { arguments: 'and":"ls"}' } }))
  chunks.push(...builder.finish())

  const starts = chunks.filter(chunk => chunk.type === 'block-start')
  const ends = chunks.filter(chunk => chunk.type === 'block-end')
  assert.equal(starts.length, 3)
  assert.deepEqual(starts.map(chunk => chunk.index), [0, 1, 2])
  assert.deepEqual(ends.map(chunk => chunk.index), [0, 1, 2])
  assert.deepEqual(builder.blockTypes(), [{ type: 'reasoning' }, { type: 'text' }, { type: 'tool-call' }])
  assert.deepEqual(ends[2].block, {
    type: 'tool-call',
    id: 'call-1',
    name: 'bash',
    arguments: '{"command":"ls"}',
  })
})

test('mapUsage subtracts cached prompt tokens and keeps reasoning tokens', () => {
  assert.deepEqual(mapUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }), {
    inputTokens: 60,
    outputTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 40,
    reasoningTokens: 5,
  })
  assert.equal(mapUsage(undefined), undefined)
})

test('provider failures map onto the canonical taxonomy with retry facts', () => {
  const headers = new Headers({ 'retry-after': '3', 'x-request-id': 'req-1' })
  const auth = providerError({ error: { message: 'invalid key', type: 'authentication_error' } }, 401, headers)
  assert.equal(auth.code, 'AUTH')
  assert.equal(auth.failure.status, 401)
  assert.equal(auth.failure.providerRetryAfterMs, 3000)
  assert.equal(auth.failure.requestId, 'req-1')

  assert.equal(providerError({ error: { message: 'insufficient credits' } }, 402).code, 'QUOTA')
  assert.equal(providerError({ error: { message: 'slow down' } }, 429).code, 'RATE_LIMIT')
  assert.equal(providerError({ error: { message: 'boom' } }, 500).code, 'SERVER')
  assert.equal(providerError({ error: { message: 'teapot' } }, 418).code, 'HTTP_418')
  assert.equal(
    providerError({ error: { message: 'This model\'s maximum context length is 1048560 tokens' } }, 400).code,
    'CONTEXT_WINDOW_EXCEEDED',
  )
  assert.equal(providerError({ error: { message: 'quota exceeded' } }, undefined).code, 'QUOTA')
  assert.equal(providerError(undefined, undefined).code, 'SERVER')
  // An unusable Retry-After must be omitted, not sent as 0 or NaN.
  assert.equal(providerError({}, 429, new Headers({ 'retry-after': '0' })).failure.providerRetryAfterMs, undefined)
})

test('mapFinish maps terminal reasons', () => {
  assert.deepEqual(mapFinish('length', false), { type: 'finish', reason: { kind: 'max-tokens' } })
  assert.deepEqual(mapFinish('tool_calls', false), { type: 'finish', reason: { kind: 'tool-calls' } })
  assert.deepEqual(mapFinish('stop', true), { type: 'finish', reason: { kind: 'tool-calls' } })
  assert.deepEqual(mapFinish('stop', false), { type: 'finish', reason: { kind: 'stop' } })
})

test('energy comments accumulate across frames and queue heartbeats resolve', () => {
  const state = createTelemetry()
  captureComment('energy {"energy_joules": 10, "carbon_g_co2eq": 0.4, "grid_id": "FI", "grid_carbon_intensity_gco2perkwhr": 42, "carbon_source": "agent_cache"}', state)
  captureComment('energy {"energy_joules": 2.5, "carbon_g_co2eq": 0.1, "grid_id": "SE"}', state)
  captureComment('cost {"request_cost_usd": 0.004}', state)
  captureComment('mcr-session {"session":"s1"}', state)
  captureComment('not-telemetry', state)
  assert.equal(state.energyJoules, 12.5)
  assert.equal(state.costUsd, 0.004)
  assert.equal(state.carbonGrams, 0.5)
  // Grid facts are latest-wins within one response.
  assert.equal(state.gridId, 'SE')
  assert.equal(state.gridIntensityGco2PerKwh, 42)
  assert.equal(state.carbonSource, 'agent_cache')
  assert.deepEqual(state.mcrSession, { session: 's1' })

  const tracker = { sawContent: false }
  captureQueue('{"created":100,"choices":[{"delta":{}}]}', state, tracker)
  captureQueue('{"created":115,"choices":[{"delta":{"content":"hi"}}]}', state, tracker)
  assert.equal(state.queueSeconds, 15)

  assert.equal(formatEnergy(0), '0 J')
  assert.match(formatEnergy(12.5), /J$/)
  assert.match(formatEnergy(3_600_000), /kWh$/)

  assert.equal(formatCarbon(0), '0 g')
  assert.equal(formatCarbon(0.5), '500.00 mg')
  assert.equal(formatCarbon(1.26), '1.26 g')
  assert.equal(formatCarbon(42), '42.0 g')
  assert.equal(formatCarbon(2100), '2.10 kg')
})

test('resolveOptions validates and detaches settings', () => {
  const resolved = resolveOptions({ baseURL: 'https://api.example.com/v1/', displayName: ' Neuralwatt ' })
  assert.equal(resolved.baseURL, 'https://api.example.com/v1')
  assert.equal(resolved.displayName, 'Neuralwatt')
  assert.equal(resolved.apiKeyEnv, 'NEURALWATT_API_KEY')
  assert.equal(resolved.hostedTools, true)
  assert.equal(resolved.retryPolicy.mode, 'normal')
  assert.match(registrationFacts(resolved), /"maxRetries":5/)
  assert.throws(() => resolveOptions({ baseURL: 'ftp://example.com' }), /INVALID_CONFIG|HTTP/)
  assert.throws(() => resolveOptions({ baseURL: 'https://user:pass@example.com' }), /credentials/)
  assert.throws(() => resolveOptions({ idleTimeoutMs: 0 }), /idleTimeoutMs/)
})

test('request images are downscaled to the declared projection', () => {
  const large = resolveRequestImageTarget({ attachmentId: 'a', mediaType: 'image/png', bytes: 8_000_000, width: 4096, height: 4096 })
  assert.deepEqual(large, { width: 2048, height: 2048, maxBytes: 1_048_576 })
  const small = resolveRequestImageTarget({ attachmentId: 'a', mediaType: 'image/png', bytes: 900, width: 64, height: 32 })
  assert.deepEqual(small, { width: 64, height: 32, maxBytes: 900 })
})

test('projection folds durable telemetry and token usage per session', () => {
  const replayState = replayEnvelope('deepseek-v4.1-flash', [{ type: 'text' }], {
    energyJoules: 42.5,
    costUsd: 0.0025,
    carbonGrams: 1.25,
    queueSeconds: 3,
    gridId: 'FI',
    gridIntensityGco2PerKwh: 42,
    carbonSource: 'agent_cache',
  })
  const event = assistantEvent({
    replayState,
    usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, totalTokens: 130 },
  })
  const once = applyUsage(usageProjectionDefinition.init(), event)
  assert.equal(once.requests, 1)
  assert.equal(once.inputTokens, 100)
  assert.equal(once.outputTokens, 30)
  assert.equal(once.cacheReadTokens, 20)
  assert.equal(once.energyJoules, 42.5)
  assert.equal(once.costUsd, 0.0025)
  assert.equal(once.carbonGrams, 1.25)
  assert.equal(once.carbonKnown, true)
  assert.equal(once.lastGridId, 'FI')
  assert.equal(once.lastGridIntensityGco2PerKwh, 42)
  assert.equal(once.lastCarbonSource, 'agent_cache')
  assert.equal(once.lastQueueSeconds, 3)
  assert.equal(once.lastModel, 'deepseek-v4.1-flash')

  // Pure fold: an unrelated event returns the same reference.
  const unrelated = { type: 'tool/result', data: {} }
  assert.equal(applyUsage(once, unrelated), once)
  // Another route's message does not enter this route's totals.
  assert.equal(applyUsage(once, assistantEvent({ provider: 'deepseek' })), once)

  const view = usageProjectionDefinition.wire.view(once)
  assert.equal(usageProjectionDefinition.wire.viewSchema.parse(JSON.parse(JSON.stringify(view))).requests, 1)
  // Unusable numbers are sanitized rather than published as NaN or negatives.
  assert.equal(usageProjectionDefinition.wire.viewSchema.parse({ provider: 'x', requests: -1 }).requests, 0)
  assert.throws(() => usageProjectionDefinition.wire.viewSchema.parse('nope'), /expected an object/)
  // An envelope from before carbon capture reads as unknown, never as a measured zero.
  const legacy = replayEnvelope('deepseek-v4.1-flash', [{ type: 'text' }], { energyJoules: 1, costUsd: 0 })
  const legacyState = applyUsage(usageProjectionDefinition.init(), assistantEvent({ replayState: legacy, usage: { inputTokens: 1, outputTokens: 1 } }))
  assert.equal(legacyState.carbonKnown, false)
  assert.equal(legacyState.carbonGrams, 0)

  // A checkpoint stored before carbon existed restores to the same state the
  // full replay produces, so the added optional fields keep stateVersion 1.
  const checkpoint = usageProjectionDefinition.stateSchema.parse({
    provider: 'neuralwatt',
    requests: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    energyJoules: 10,
    costUsd: 0,
  })
  const next = assistantEvent({ replayState, usage: { inputTokens: 5, outputTokens: 5 } })
  const fromCheckpoint = applyUsage(checkpoint, next)
  const fromReplay = applyUsage({ ...checkpoint, carbonGrams: 0, carbonKnown: false }, next)
  assert.deepEqual(fromCheckpoint, fromReplay)
})

test('replay envelope round-trips and refuses cross-model replay', () => {
  const envelope = replayEnvelope('deepseek-v4.1-flash', [{ type: 'reasoning' }, { type: 'text' }], {
    energyJoules: 1,
    costUsd: 0,
    carbonGrams: 0.25,
    gridId: 'FR',
    gridIntensityGco2PerKwh: 56,
    carbonSource: 'regional_fallback',
  })
  assert.deepEqual(readTelemetry(envelope), {
    energyJoules: 1,
    costUsd: 0,
    carbonGrams: 0.25,
    gridId: 'FR',
    gridIntensityGco2PerKwh: 56,
    carbonSource: 'regional_fallback',
  })
  assert.equal(readTelemetry({ response: { kind: 'other' } }), undefined)
})

test('model listing parsing accepts data arrays and models maps', () => {
  const data = parseModelListing({
    data: [
      { id: 'a', context_length: 1000, max_output_tokens: 100 },
      { id: 'b', name: 'B' },
      { nope: true },
    ],
  })
  assert.deepEqual(data, [
    { id: 'a', name: 'a', contextWindow: 1000, maxTokens: 100 },
    { id: 'b', name: 'B' },
  ])
  const mapped = parseModelListing({ models: { 'x/1': { display_name: 'X' }, scalar: 3 } })
  assert.deepEqual(mapped, [{ id: 'x/1', name: 'X' }])
  assert.throws(() => parseModelListing({ nope: [] }), /DISCOVERY_FAILED|model listing/)
})
