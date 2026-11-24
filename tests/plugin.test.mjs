import test from 'node:test'
import assert from 'node:assert/strict'
import { __internals } from '../lib/index.js'

const { Catalog, serialize, parseSse, BlockBuilder, mapUsage, captureComment, captureQueue, createTelemetry, formatEnergy } =
  __internals

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

test('catalog lists the ported upstream models', () => {
  const catalog = new Catalog()
  const models = catalog.list('neuralwatt')
  assert.ok(models.length >= 20, `expected the full catalog, saw ${models.length}`)
  assert.ok(models.every(model => model.provider === 'neuralwatt'))
  assert.ok(models.some(model => model.id === 'deepseek-v4.1-flash'))
  assert.ok(models.some(model => model.id === 'kimi-k3.1-pro'))
  // Classifiers are not chat routes and must not be advertised.
  assert.ok(!models.some(model => model.id === 'clef-flash'))
})

test('catalog resolves context, output cap, modalities and efforts', () => {
  const catalog = new Catalog()
  const flash = catalog.resolve('neuralwatt', 'deepseek-v4.1-flash')
  assert.equal(flash.context.contextWindow, 1048560)
  assert.equal(flash.defaultMaxTokens, 393216)
  assert.deepEqual(flash.inputModalities, ['text', 'image'])
  assert.deepEqual(flash.reasoning.efforts.map(effort => effort.id), ['off', 'low', 'high', 'max'])
  assert.equal(catalog.effortWire('deepseek-v4.1-flash', 'off'), 'none')
  assert.equal(catalog.effortWire('deepseek-v4.1-flash', 'medium'), undefined)

  const textOnly = catalog.resolve('neuralwatt', 'glm-5.3')
  assert.deepEqual(textOnly.inputModalities, ['text'])
})

test('an unlisted model still routes with neutral defaults', () => {
  const info = new Catalog().resolve('neuralwatt', 'something-new')
  assert.deepEqual(info, { provider: 'neuralwatt', id: 'something-new', name: 'something-new' })
})

test('serialize maps system, user images, tools and reasoning effort', () => {
  const body = serialize(
    {
      provider: 'neuralwatt',
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
      maxTokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'system', id: 's1', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'be brief' }] },
        {
          role: 'user',
          id: 'u1',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'what is this?' },
            {
              type: 'image',
              attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
            },
          ],
        },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    },
    new Catalog().get('deepseek-v4.1-flash'),
    new Map([['a1', { mediaType: 'image/png', base64: 'AAAA' }]]),
  )

  assert.equal(body.model, 'deepseek-v4.1-flash')
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.max_tokens, 1024)
  assert.equal(body.temperature, 0.2)
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[1].role, 'user')
  assert.deepEqual(body.messages[1].content, [
    { type: 'text', text: 'what is this?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ])
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } } }])
})

test('serialize keeps assistant tool calls and tool results correlated', () => {
  const body = serialize(
    {
      provider: 'neuralwatt',
      model: 'glm-5.3',
      messages: [
        {
          role: 'assistant',
          id: 'a1',
          source: { kind: 'model', provider: 'neuralwatt', model: 'glm-5.3' },
          content: [
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
    },
    new Catalog().get('glm-5.3'),
    new Map(),
  )
  assert.equal(body.messages[0].content, 'checking')
  assert.deepEqual(body.messages[0].tool_calls, [
    { id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
  ])
  assert.equal(body.messages[1].role, 'tool')
  assert.equal(body.messages[1].tool_call_id, 'call-1')
  assert.equal(body.reasoning_effort, undefined)
})

test('serialize sends the qwen chat-template thinking switch', () => {
  const model = { id: 'qwen', name: 'Qwen', contextWindow: 1000, maxTokens: 100, input: ['text'], compat: { thinkingFormat: 'chat-template' } }
  const off = serialize(
    { provider: 'neuralwatt', model: 'qwen', reasoningEffort: 'off', messages: [] },
    model,
    new Map(),
  )
  assert.deepEqual(off.chat_template_kwargs, { enable_thinking: false })
  const high = serialize(
    { provider: 'neuralwatt', model: 'qwen', reasoningEffort: 'high', messages: [] },
    model,
    new Map(),
  )
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
  assert.equal(chunks.filter(chunk => chunk.type === 'tool-call-delta').length, 2)
  assert.deepEqual(ends[2].block, {
    type: 'tool-call',
    id: 'call-1',
    name: 'bash',
    arguments: '{"command":"ls"}',
  })
  assert.equal(chunks.at(-1).index, 2)
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

test('energy comments accumulate across frames and queue heartbeats resolve', () => {
  const state = createTelemetry()
  captureComment('energy {"energy_joules": 10}', state)
  captureComment('energy {"energy_joules": 2.5}', state)
  captureComment('cost {"request_cost_usd": 0.004}', state)
  captureComment('mcr-session {"session":"s1"}', state)
  captureComment('not-telemetry', state)
  assert.equal(state.energyJoules, 12.5)
  assert.equal(state.costUsd, 0.004)
  assert.deepEqual(state.mcrSession, { session: 's1' })

  const tracker = { sawContent: false }
  captureQueue('{"created":100,"choices":[{"delta":{}}]}', state, tracker)
  captureQueue('{"created":115,"choices":[{"delta":{"content":"hi"}}]}', state, tracker)
  assert.equal(state.queueSeconds, 15)

  assert.equal(formatEnergy(0), '0 J')
  assert.match(formatEnergy(12.5), /J$/)
  assert.match(formatEnergy(3_600_000), /kWh$/)
})
