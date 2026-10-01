#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { closeSync } from 'node:fs'
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
const write = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)
let prompt
let sessionId = `native-${process.pid}`
for await (const line of lines) {
  const frame = JSON.parse(line)
  if (frame.method === 'initialize') {
    const params = frame.params
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
    write({ id: frame.id, result: { sessionId } })
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
        if (prompt === pending) prompt = undefined
      }, 100)
      continue
    }
    write({ id: prompt.id, result: { stopReason: 'cancelled' } })
    prompt = undefined
    continue
  }
  if (frame.method === 'session/prompt') {
    if (prompt) {
      write({ id: frame.id, error: { code: -32000, message: 'Native prompt still active' } })
      continue
    }
    prompt = frame
    if (args.includes('--audit-native')) write({ method: 'fixture/prompt-started', params: {} })
    const text = frame.params.prompt[0].text
    if (text === 'hold') continue
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
    write({ id: frame.id, result: { stopReason: 'end_turn' } })
    prompt = undefined
    continue
  }
  if (frame.id === 'permission-1') {
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
