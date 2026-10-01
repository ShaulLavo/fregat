#!/usr/bin/env node
import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
const write = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)
let prompt
let sessionId = `native-${process.pid}`
for await (const line of lines) {
  const frame = JSON.parse(line)
  if (frame.method === 'initialize') {
    write({
      id: frame.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
        authMethods: [{ id: 'fixture-login' }],
      },
    })
    continue
  }
  if (frame.method === 'session/new') {
    write({ id: frame.id, result: { sessionId } })
    continue
  }
  if (frame.method === 'session/load' || frame.method === 'session/resume') {
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
  if (frame.method === 'fixture/hang') continue
  if (frame.method === 'session/cancel') {
    if (prompt) write({ id: prompt.id, result: { stopReason: 'cancelled' } })
    prompt = undefined
    continue
  }
  if (frame.method === 'session/prompt') {
    prompt = frame
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
