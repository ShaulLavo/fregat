#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { appendFileSync, closeSync } from 'node:fs'
// Independent consumed-shape checks follow ACP v0.11.3 schema.unstable.json
// at e87bde7322ceb8d52d9e81718f5783beb66f9f6d, not the peer implementation.
const args = process.argv.slice(2)
if (args.includes('--audit-stdio'))
  process.stderr.write(
    `${JSON.stringify({ event: 'fixture-runtime', pid: process.pid, executable: process.execPath })}\n`,
  )
if (args.includes('--no-read')) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'fixture/ready', params: { pid: process.pid } })}\n`,
  )
  process.stdin.pause()
  setInterval(() => undefined, 1000)
  await new Promise(() => undefined)
}

const lines = createInterface({ input: process.stdin })
const tracePath =
  process.env.FREGAT_ACP_FIXTURE_LOG ??
  (process.argv[1].endsWith('/fake-acp.mjs') ? undefined : new URL('native.jsonl', import.meta.url))
const trace = (entry) => {
  // Audit metadata preserves header names while keeping credentials out of retained evidence.
  const audited = JSON.stringify(entry, (key, value) =>
    key === 'headers' && Array.isArray(value)
      ? value.map((header) => ({ ...header, value: '[redacted]' }))
      : value,
  )
  if (tracePath) appendFileSync(tracePath, `${audited}\n`)
}
trace({
  event: 'spawn',
  pid: process.pid,
  args: process.argv.slice(2),
  profile: process.env.XDG_CONFIG_HOME,
})
const write = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)
let prompt
let parameterizedModels = false
const active = new Map()
let sessionId = `native-${process.pid}`
for await (const line of lines) {
  const frame = JSON.parse(line)
  trace({ event: 'rpc', ...frame })
  if (frame.method === 'initialize') {
    const params = frame.params
    parameterizedModels = params?.clientCapabilities?._meta?.parameterizedModelPicker === true
    const implementation = params?.clientInfo
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    const valid =
      object(params) &&
      params.protocolVersion === 1 &&
      (params.clientCapabilities === undefined || object(params.clientCapabilities)) &&
      (implementation == null ||
        (object(implementation) &&
          typeof implementation.name === 'string' &&
          typeof implementation.version === 'string'))
    if (!valid) {
      write({ id: frame.id, error: { code: -32602, message: 'Invalid initialization shape' } })
      continue
    }
    const resume = {}
    if (!args.includes('--resume=absent'))
      resume.resume = args.includes('--resume=null') ? null : {}
    write({
      id: frame.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: !args.includes('--load=false'),
          sessionCapabilities: resume,
        },
        authMethods: [{ id: 'fixture-login', name: 'Fixture login' }],
      },
    })
    continue
  }
  if (frame.method === 'session/new') {
    if (frame.params.mcpServers?.length)
      trace({
        event: 'native-mcp',
        authorizationReceived: frame.params.mcpServers.some((server) =>
          server.headers?.some(
            (header) => header.name === 'Authorization' && header.value.startsWith('Bearer '),
          ),
        ),
      })
    write({
      id: frame.id,
      result: {
        sessionId,
        modes: {
          currentModeId: 'agent',
          availableModes: [
            { id: 'agent', name: 'Agent' },
            { id: 'plan', name: 'Plan' },
          ],
        },
      },
    })
    continue
  }
  if (frame.method === 'session/load' || frame.method === 'session/resume') {
    if (args.includes('--audit-native'))
      write({ method: 'fixture/operation', params: { method: frame.method } })
    sessionId = frame.params.sessionId
    write({
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAY' } },
      },
    })
    write({ id: frame.id, result: {} })
    continue
  }
  if (frame.method === 'cursor/list_available_models') {
    if (!parameterizedModels) {
      write({
        id: frame.id,
        error: { code: -32602, message: 'Parameterized model capability required' },
      })
      continue
    }
    if (args.includes('--catalog-hang')) continue
    if (args.includes('--catalog-malformed')) {
      write({
        id: frame.id,
        result: {
          models: [
            {
              value: 'broken',
              name: 'Broken',
              configOptions: [
                { type: 'boolean', id: 'fast', name: 'Fast', currentValue: 'invalid' },
              ],
            },
          ],
        },
      })
      continue
    }
    write({
      id: frame.id,
      result: {
        models: [
          { value: 'auto', name: 'Automatic' },
          {
            value: 'fixture-cursor-small',
            name: 'Fixture small',
            configOptions: [
              {
                id: 'reasoning',
                name: 'Reasoning',
                type: 'select',
                currentValue: 'high',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'high', name: 'High' },
                ],
              },
              {
                id: 'context',
                name: 'Context',
                description: 'Native context choice',
                type: 'select',
                currentValue: 'wide',
                options: [
                  {
                    group: 'sizes',
                    name: 'Sizes',
                    options: [
                      { value: 'small', name: 'Small' },
                      { value: 'wide', name: 'Wide' },
                    ],
                  },
                ],
              },
              { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
            ],
          },
        ],
      },
    })
    continue
  }
  if (frame.method === 'fixture/error') {
    write({ id: frame.id, error: { code: -32000, message: 'fixture failure' } })
    continue
  }
  if (frame.method === 'fixture/malformed') {
    process.stdout.write('not-json\n')
    continue
  }
  if (frame.method === 'fixture/exit') process.exit(7)
  if (frame.method === 'fixture/pid') {
    write({ id: frame.id, result: process.pid })
    continue
  }
  if (frame.method === 'fixture/stdout-eof') {
    closeSync(1)
    if (args.includes('--audit-stdio'))
      process.stderr.write(`${JSON.stringify({ event: 'fd1-closed', pid: process.pid })}\n`)
    setInterval(() => undefined, 1000)
    continue
  }
  if (frame.method === 'fixture/stdin-eof') {
    write({ id: frame.id, result: true })
    process.stdin.pause()
    closeSync(0)
    setInterval(() => undefined, 1000)
    continue
  }
  if (frame.method === 'fixture/hang') continue
  if (frame.method === 'session/cancel') {
    if (args.includes('--audit-native')) write({ method: 'fixture/cancel-received', params: {} })
    if (!prompt) continue
    if (args.includes('--late-cancel')) {
      const pending = prompt
      setTimeout(() => {
        write({ id: pending.id, result: { stopReason: 'cancelled' } })
        active.delete(pending.id)
        if (prompt === pending) prompt = undefined
      }, 100)
      continue
    }
    for (const pending of active.values())
      write({ id: pending.id, result: { stopReason: 'cancelled' } })
    active.clear()

    prompt = undefined
    continue
  }
  if (frame.method === 'session/prompt') {
    if (prompt && !args.includes('acp')) {
      write({ id: frame.id, error: { code: -32000, message: 'Native prompt still active' } })
      continue
    }
    const previous = prompt
    prompt = frame
    active.set(frame.id, frame)
    if (args.includes('--audit-native')) write({ method: 'fixture/prompt-started', params: {} })

    const text = frame.params.prompt[0].text
    if (text === 'exit-native') process.exit(19)
    if (text === 'fail') {
      write({ id: frame.id, error: { code: -32000, message: 'fixture turn failed' } })
      active.delete(frame.id)
      prompt = undefined
      continue
    }
    if (text === 'hold') continue
    if (text === 'todos')
      write({
        method: 'cursor/update_todos',
        params: {
          toolCallId: 'todo-tool',
          merge: false,
          todos: [{ id: 'todo-1', content: 'Fixture step', status: 'inProgress' }],
        },
      })
    if (text === 'question') {
      write({
        id: 'question-1',
        method: 'cursor/ask_question',
        params: {
          sessionId,
          toolCallId: 'q-tool',
          questions: [
            {
              id: 'choice',
              prompt: 'Pick a fixture choice',
              options: [{ id: 'one', label: 'One' }],
            },
          ],
        },
      })
      continue
    }
    if (text === 'plan') {
      write({
        id: 'plan-1',
        method: 'cursor/create_plan',
        params: { sessionId, toolCallId: 'plan-tool', plan: '# Fixture plan', todos: [] },
      })
      continue
    }
    if (text === 'permission') {
      write({
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 'tool-1', title: 'Fixture command', kind: 'execute' },
          options: [
            { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        },
      })
      continue
    }
    write({
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `fixture:${text}:${sessionId}` },
        },
      },
    })
    if (previous) {
      write({ id: previous.id, result: { stopReason: 'end_turn' } })
      active.delete(previous.id)
    }
    write({ id: frame.id, result: { stopReason: 'end_turn' } })
    active.delete(frame.id)
    prompt = undefined
    continue
  }
  if (frame.id === 'question-1' || frame.id === 'plan-1') {
    if (!prompt) continue
    active.delete(prompt.id)
    write({ id: prompt.id, result: { stopReason: 'end_turn' } })
    prompt = undefined
    continue
  }
  if (frame.id === 'permission-1') {
    if (!prompt) continue
    active.delete(prompt.id)
    write({
      id: prompt.id,
      result: {
        stopReason: frame.result.outcome.outcome === 'selected' ? 'end_turn' : 'cancelled',
      },
    })
    prompt = undefined
    continue
  }
  write({ id: frame.id, result: {} })
}
