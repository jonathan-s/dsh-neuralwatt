import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/index.js'

/** Start a one-shot HTTP endpoint. */
async function startServer(handler) {
  const server = createServer((request, response) => handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/v1`, close: () => new Promise(resolve => server.close(resolve)) }
}

/** Let injected child fibers settle. */
function settle() {
  return new Promise(resolve => setTimeout(resolve, 30))
}

/**
 * Mount the plugin against stubbed services and return every registration it made.
 * @param {object} options - plain plugin options; mutated fields are re-read per request.
 * @param {object} [overrides] - stubbed services to replace or extend.
 */
async function mount(options, overrides = {}) {
  const ctx = new Context()
  const state = {
    registered: undefined,
    directory: undefined,
    discovery: undefined,
    tool: undefined,
    quotaRoute: undefined,
    replaceCalls: 0,
    directoryReplaces: 0,
    usageStates: new Map(),
  }
  ctx.provide('llm', {
    registerAdapter(routes, adapter) {
      state.registered = { routes, adapter }
      const handle = () => {}
      handle.replace = () => { state.replaceCalls += 1 }
      return handle
    },
    registerConfigurableProviders(entries) {
      state.directory = entries
      return {
        replace(next) {
          state.directoryReplaces += 1
          state.directory = next
        },
      }
    },
    registerModelDiscovery(settingsNs, discover) {
      state.discovery = { settingsNs, discover }
    },
    ...overrides.llm,
  })
  ctx.provide('tools', {
    register(definition, registrationOptions) {
      state.tool = { definition, registrationOptions }
    },
    ...overrides.tools,
  })
  ctx.provide('credentials', overrides.credentials ?? {
    resolve: async () => ({ value: 'test-key' }),
    describe: async () => ({ configured: true }),
  })
  ctx.provide('sessionProjections', {
    register(definition) {
      state.projectionDefinition = definition
      return Promise.resolve({
        stateOf(session) {
          return state.usageStates.get(session)
        },
      })
    },
    ...overrides.sessionProjections,
  })
  ctx.provide('connection', {
    fetch: {
      register(route) {
        state.quotaRoute = route
        return () => Promise.resolve()
      },
    },
    ...overrides.connection,
  })
  apply(ctx, options)
  await settle()
  return { ctx, state }
}

/** One SSE data frame. */
function frame(value) {
  return `data: ${JSON.stringify(value)}\n\n`
}

/** Drain one adapter stream. */
async function collect(adapter, request) {
  const chunks = []
  for await (const chunk of adapter.stream(request)) chunks.push(chunk)
  return chunks
}

test('plugin registers the route, directory entry, discovery, projection, quota route and tool', async () => {
  const { state } = await mount({ baseURL: 'http://127.0.0.1:1/v1' })
  assert.deepEqual(state.registered.routes, ['neuralwatt'])
  assert.equal(state.registered.adapter.providerInfo('neuralwatt').name, 'Neuralwatt')
  assert.equal(state.directory[0].provider, 'neuralwatt')
  assert.equal(state.directory[0].settingsNs, 'llm-neuralwatt')
  assert.deepEqual(state.directory[0].settingsPath, [])
  assert.deepEqual(state.directory[0].nativeAuth, { env: ['NEURALWATT_API_KEY'], oauth: false })
  assert.equal(state.discovery.settingsNs, 'llm-neuralwatt')
  assert.equal(state.projectionDefinition.key, 'neuralwattUsage')
  assert.equal(state.quotaRoute.path, '/api/neuralwatt.quota')
  assert.equal(state.tool.definition.name, 'neuralwatt_status')
  assert.equal(state.tool.registrationOptions.when({ modelSelection: { provider: 'deepseek' } }), false)
  assert.equal(state.tool.registrationOptions.when({ modelSelection: { provider: 'neuralwatt' } }), true)
})

test('discovery answers a configured Neuralwatt route from the shipped catalog', async () => {
  const { state } = await mount({ baseURL: 'http://127.0.0.1:1/v1' })
  const models = await state.discovery.discover({ provider: 'neuralwatt' })
  assert.ok(models.length >= 20)
  assert.ok(models.every(model => model.contextWindow > 0))
  await assert.rejects(() => state.discovery.discover({ provider: 'other' }), /baseURL/)
})

test('discovery interrogates an unknown endpoint at GET /models', async () => {
  const server = await startServer((request, response) => {
    request.resume()
    assert.equal(request.url, '/v1/models')
    assert.equal(request.headers.authorization, 'Bearer drafted-key')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'draft-model', context_length: 8192 }] }))
  })
  try {
    const { state } = await mount({ baseURL: 'http://127.0.0.1:1/v1' })
    const models = await state.discovery.discover({ provider: 'other', baseURL: server.url, apiKey: 'drafted-key' })
    assert.deepEqual(models, [{ id: 'draft-model', name: 'draft-model', contextWindow: 8192 }])
  } finally {
    await server.close()
  }
})

test('stream() translates text, reasoning, a tool call, usage, energy and finish', async () => {
  let received
  const server = await startServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      received = { headers: request.headers, body: JSON.parse(body) }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(': energy {"energy_joules": 42.5}\n\n')
      response.write(frame({ created: 100, choices: [{ delta: { reasoning_content: 'think' } }] }))
      response.write(frame({ created: 105, choices: [{ delta: { content: 'Hel' } }] }))
      response.write(frame({ created: 105, choices: [{ delta: { content: 'lo' } }] }))
      response.write(frame({
        created: 106,
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-9', function: { name: 'bash', arguments: '{"command":' } }] } }],
      }))
      response.write(frame({
        created: 106,
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }, finish_reason: 'tool_calls' }],
      }))
      response.write(frame({
        created: 107,
        choices: [],
        usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } },
      }))
      response.write(': cost {"request_cost_usd": 0.0025}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  try {
    const { state } = await mount({ baseURL: server.url, logEnergy: true })
    const chunks = await collect(state.registered.adapter, {
      provider: 'neuralwatt',
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
      maxTokens: 256,
      system: 'be brief',
      messages: [
        { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'list files' }] },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    })

    assert.equal(received.headers.authorization, 'Bearer test-key')
    assert.equal(received.headers.accept, 'text/event-stream')
    assert.equal(received.body.reasoning_effort, 'high')
    assert.equal(received.body.tools.length, 1)
    assert.deepEqual(received.body.messages[0], { role: 'system', content: 'be brief' })

    const kinds = chunks.map(chunk => chunk.type)
    assert.deepEqual(kinds, [
      'block-start', 'reasoning-delta',
      'block-start', 'text-delta', 'text-delta',
      'block-start', 'tool-call-delta', 'tool-call-delta',
      'block-end', 'block-end', 'block-end',
      'usage', 'finish',
    ])
    const usage = chunks.find(chunk => chunk.type === 'usage')
    assert.deepEqual(usage.usage, { inputTokens: 100, outputTokens: 30, totalTokens: 150, cacheReadTokens: 20 })
    const finish = chunks.at(-1)
    assert.deepEqual(finish.reason, { kind: 'tool-calls' })
    assert.equal(finish.replayState.response.kind, 'neuralwatt-chat')
    assert.equal(finish.replayState.response.model, 'deepseek-v4.1-flash')
    assert.deepEqual(finish.replayState.response.telemetry, { energyJoules: 42.5, costUsd: 0.0025 })
    assert.deepEqual(finish.replayState.blocks, [{ type: 'reasoning' }, { type: 'text' }, { type: 'tool-call' }])
  } finally {
    await server.close()
  }
})

test('stream() maps an HTTP failure to a typed LlmError with retry facts', async () => {
  const server = await startServer((request, response) => {
    request.resume()
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2', 'x-request-id': 'req-7' })
    response.end(JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_error' } }))
  })
  try {
    const { state } = await mount({ baseURL: server.url })
    await assert.rejects(
      () => collect(state.registered.adapter, {
        provider: 'neuralwatt',
        model: 'glm-5.3',
        messages: [
          { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
        ],
      }),
      (error) => {
        assert.equal(error.name, 'LlmError')
        assert.equal(error.code, 'RATE_LIMIT')
        assert.equal(error.failure.status, 429)
        assert.equal(error.failure.providerRetryAfterMs, 2000)
        assert.equal(error.failure.requestId, 'req-7')
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('stream() classifies an empty completion and a content refusal', async () => {
  const empty = await startServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: [DONE]\n\n')
  })
  const refused = await startServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(frame({ created: 1, choices: [{ delta: { content: 'x' }, finish_reason: 'content_filter' }] }))
  })
  try {
    const emptyMount = await mount({ baseURL: empty.url })
    await assert.rejects(
      () => collect(emptyMount.state.registered.adapter, {
        provider: 'neuralwatt',
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
      }),
      /EMPTY_RESPONSE|empty response/,
    )
    const refusedMount = await mount({ baseURL: refused.url })
    await assert.rejects(
      () => collect(refusedMount.state.registered.adapter, {
        provider: 'neuralwatt',
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
      }),
      (error) => error.code === 'CONTENT_REFUSED',
    )
  } finally {
    await empty.close()
    await refused.close()
  }
})

test('status tool reports session totals and survives an unreachable quota endpoint', async () => {
  const { state } = await mount({ baseURL: 'http://127.0.0.1:1/v1' })
  state.usageStates.set('session-1', {
    provider: 'neuralwatt',
    requests: 2,
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 200,
    energyJoules: 5400,
    costUsd: 0.0042,
    lastQueueSeconds: 4,
    lastModel: 'deepseek-v4.1-flash',
  })
  const value = await state.tool.definition.execute({}, {
    agent: { session: 'session-1' },
    signal: new AbortController().signal,
  })
  assert.match(value.report, /Session requests: 2/)
  assert.match(value.report, /1,200 in, 340 out, 200 cached/)
  assert.match(value.report, /Session energy: 1\.500 Wh; billed \$0\.004200/)
  assert.match(value.report, /Last flex queue wait: 4\.0 s/)
  assert.match(value.report, /Account quota: unavailable/)
})

test('quota route answers the provider card with a snapshot', async () => {
  const server = await startServer((request, response) => {
    request.resume()
    if (request.url === '/v1/quota') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ subscription: { plan: 'pro', status: 'active' }, balance: { credits_remaining_usd: 12.5 } }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  try {
    const { state } = await mount({ baseURL: server.url })
    const response = await state.quotaRoute.fetch(new Request('http://localhost/api/neuralwatt.quota'))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.configured, true)
    assert.equal(payload.quota.subscription.plan, 'pro')
  } finally {
    await server.close()
  }
})

test('a volatile update re-registers only when a captured fact changes', async () => {
  const options = { baseURL: 'http://127.0.0.1:1/v1', displayName: 'Neuralwatt' }
  const { ctx, state } = await mount(options)
  assert.equal(state.replaceCalls, 0)
  ctx.emit('loader/volatile-update')
  assert.equal(state.replaceCalls, 0, 'an unchanged policy must not re-register')
  options.displayName = 'Neuralwatt Pro'
  ctx.emit('loader/volatile-update')
  assert.equal(state.replaceCalls, 1, 'a renamed provider re-registers its route')
  assert.equal(state.registered.adapter.providerInfo('neuralwatt').name, 'Neuralwatt Pro')
  assert.equal(state.directory[0].displayName, 'Neuralwatt Pro')
})
