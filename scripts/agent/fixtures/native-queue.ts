#!/usr/bin/env node
import {
  fixtureIO,
  trackLifecycle,
  codexInitialization,
  codexModels,
  beginTurn,
  readRequests,
} from './runtime.ts'
import type { FixtureRequest } from './protocol.ts'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const { root, record, send } = fixtureIO(import.meta.url)
const threadId = `${basename(root)}-thread`
let turnCount = 0
let turnId = ''
let lastControl = ''
let heldInterrupt: string | number | null = null

const thread = () => ({
  id: threadId,
  sessionId: threadId,
  projectId: null,
  cliVersion: 'verification',
  createdAt: 0,
  updatedAt: 0,
  cwd: process.cwd(),
  ephemeral: false,
  modelProvider: 'openai',
  preview: 'Queue verification',
  source: 'appServer',
  status: { type: turnId ? 'active' : 'idle' },
  turns: [],
})

function finish(status = 'completed') {
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status, items: [] } },
  })
}

function boundary(id: string) {
  const item = { id, type: 'commandExecution', command: `echo ${id}`, status: 'inProgress' }
  send({ method: 'item/started', params: { threadId, turnId, item } })
  send({
    method: 'item/completed',
    params: { threadId, turnId, item: { ...item, status: 'completed', exitCode: 0 } },
  })
}

function requestApproval() {
  send({
    id: 991,
    method: 'mcpServer/elicitation/request',
    params: {
      threadId,
      turnId,
      mode: 'form',
      message: 'Allow ChatGPT to use Queue Verification?',
      serverName: 'queue-verification-only',
      requestedSchema: {
        properties: {
          approval: {
            enum: ['once', 'session', 'always'],
            enumNames: ['Allow once', 'Allow this session', 'Always allow Queue Verification'],
          },
        },
        required: ['approval'],
      },
    },
  })
}

function readControl() {
  try {
    return JSON.parse(readFileSync(join(root, 'queue-control.json'), 'utf8'))
  } catch {
    return null
  }
}

function control() {
  if (!turnId) return
  const next = readControl()
  if (!next || next.id === lastControl) return
  lastControl = next.id
  if (next.action === 'boundary') boundary(next.id)
  if (next.action === 'approval') requestApproval()
  if (next.action === 'complete') finish()
  if (next.action === 'reject-interrupt' && heldInterrupt !== null) {
    send({ id: heldInterrupt, error: { code: -32000, message: 'QUEUE_INTERRUPT_REJECTED' } })
    heldInterrupt = null
    record({ event: 'interrupt-rejected' })
  }
  record({ event: 'control', id: next.id, action: next.action })
}

function recordInput(message: FixtureRequest) {
  const input = message.params.input
  const files = input
    .filter(
      (item): item is Extract<typeof item, { type: 'text' }> =>
        item.type === 'text' && item.text.startsWith('Attached file '),
    )
    .map((item) => {
      const path = JSON.parse(item.text.slice(item.text.indexOf(': ') + 2))
      return { path, contents: readFileSync(path, 'utf8') }
    })
  record({ event: message.method, input, files })
}

function start(message: FixtureRequest) {
  turnId = `${threadId}-${process.pid}-${++turnCount}`
  recordInput(message)
  beginTurn(send, message, threadId, turnId)
  const recovered = message.params.input.some(
    (item) => item.type === 'text' && item.text.includes('QUEUE_RECOVER'),
  )
  if (!recovered) return
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: { id: `${turnId}-answer`, type: 'agentMessage', text: 'QUEUE_PAYLOAD_VERIFIED' },
    },
  })
  finish()
}

function handle(message: FixtureRequest) {
  if (message.id === 991 && !message.method) {
    record({ event: 'approval-response', result: message.result })
    return
  }
  if (message.id === undefined) return
  if (message.method === 'turn/start') return start(message)
  if (message.method === 'turn/steer') {
    recordInput(message)
    send({ id: message.id, result: { turnId } })
    return
  }
  if (message.method === 'turn/interrupt') {
    heldInterrupt = message.id
    record({ event: 'interrupt-requested' })
    return
  }
  const result = response(message.method)
  if (result !== undefined) {
    send({ id: message.id, result })
    return
  }
  send({
    id: message.id,
    error: { code: -32601, message: `Unsupported queue fixture method ${message.method}` },
  })
}

function response(method: string | undefined) {
  switch (method) {
    case 'initialize':
      return codexInitialization(root)
    case 'account/read':
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    case 'model/list':
      return codexModels('Queue verification', 'Isolated queue fixture')
    case 'thread/start':
    case 'thread/resume':
      return {
        thread: thread(),
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cwd: process.cwd(),
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'dangerFullAccess' },
      }
    case 'thread/read':
      return { thread: thread() }
    case 'thread/list':
      return { data: [], nextCursor: null }
    case 'skills/list':
      return { data: [] }
    default:
      return undefined
  }
}

trackLifecycle(record)
setInterval(control, 25)
readRequests(handle)
