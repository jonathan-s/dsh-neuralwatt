import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config } from '../lib/index.js'

/** Start a one-shot OpenAI-compatible SSE endpoint. */
async function startServer(handler) {
  const server = createServer((request, response) => handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/v1`, close: () => new Promise(resolve => server.close(resolve)) }
}

/** Mount the plugin against a stub context and return the captured route. */
async function mount(url) {
  const ctx = new Context()
  let registered
  let tool
  const logs = []
  ctx.provide('llm', {
    registerAdapter(routes, adapter) {
      registered = { routes, adapter }
      return { dispose() {}, replace() {} }
    },
  })
  ctx.provide('tools', { register(definition) { tool = definition } })
  ctx.provide('credentials', { resolve: async () => ({ value: 'test-key' }) })
  apply(ctx, Config({ baseURL: url, logEnergy: true, timeoutMs: 30_000 }))
  // ctx.inject() mounts a child fiber; let it settle before inspecting it.
  await new Promise(resolve => setTimeout(resolve, 20))
  return { registered, tool: () => tool, logs }
}

/** One SSE data frame. */
function frame(value) {
  return `data: ${JSON.stringify(value)}\n\n`
}

test('plugin registers the neuralwatt route and the status tool', async () => {
  const { registered, tool } = await mount('http://127.0.0.1:1/v1')
  assert.deepEqual(registered.routes, ['neuralwatt'])
  assert.equal(registered.adapter.providerInfo('neuralwatt').name, 'Neuralwatt')
  assert.equal(tool()?.name, 'neuralwatt_status')
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
    const { registered } = await mount(server.url)
    const chunks = []
    for await (const chunk of registered.adapter.stream({
      provider: 'neuralwatt',
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
      maxTokens: 256,
      messages: [
        { role: 'system', id: 's', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'brief' }] },
        { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'list files' }] },
      ],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    })) {
      chunks.push(chunk)
    }

    assert.equal(received.headers.authorization, 'Bearer test-key')
    assert.equal(received.headers.accept, 'text/event-stream')
    assert.equal(received.body.model, 'deepseek-v4.1-flash')
    assert.equal(received.body.max_tokens, 256)
    assert.equal(received.body.reasoning_effort, 'high')
    assert.equal(received.body.tools.length, 1)

    const kinds = chunks.map(chunk => chunk.type)
    assert.deepEqual(kinds, [
      'block-start', 'reasoning-delta',
      'block-start', 'text-delta', 'text-delta',
      'block-start', 'tool-call-delta', 'tool-call-delta',
      'block-end', 'block-end', 'block-end',
      'usage', 'finish',
    ])
    const ends = chunks.filter(chunk => chunk.type === 'block-end')
    assert.deepEqual(ends[0].block, { type: 'reasoning', text: 'think' })
    assert.deepEqual(ends[1].block, { type: 'text', text: 'Hello' })
    assert.deepEqual(ends[2].block, { type: 'tool-call', id: 'call-9', name: 'bash', arguments: '{"command":"ls"}' })
    assert.deepEqual(chunks.at(-2).usage, { inputTokens: 100, outputTokens: 30, totalTokens: 150, cacheReadTokens: 20 })
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
    // Energy and billed cost arrive as SSE comments, not payload fields.
    const stats = registered.adapter.snapshot()
    assert.equal(stats.requests, 1)
    assert.equal(stats.energyJoules, 42.5)
    assert.equal(stats.costUsd, 0.0025)
    assert.equal(stats.inputTokens, 100)
    assert.equal(stats.outputTokens, 30)
  } finally {
    await server.close()
  }
})

test('stream() maps an HTTP failure to a typed LlmError', async () => {
  const server = await startServer((request, response) => {
    request.resume()
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'invalid key', code: 'AUTH' } }))
  })
  try {
    const { registered } = await mount(server.url)
    await assert.rejects(
      async () => {
        for await (const _chunk of registered.adapter.stream({
          provider: 'neuralwatt',
          model: 'glm-5.3',
          messages: [{ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
        })) { /* drain */ }
      },
      (error) => {
        assert.equal(error.name, 'LlmError')
        assert.equal(error.code, 'AUTH')
        assert.equal(error.failure.status, 401)
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('status tool reports process totals and survives an unreachable quota endpoint', async () => {
  const { tool } = await mount('http://127.0.0.1:1/v1')
  assert.ok(tool() !== undefined, 'status tool was not registered')
  const value = await tool().execute({}, {})
  assert.match(value.report, /Requests this process: 0/)
  assert.match(value.report, /Account quota: unavailable/)
})
