#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const threadId = `${basename(root)}-thread`
const record = (entry) => appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify(entry)}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
let turnCount = 0
let turnId = ''
let lastControl = ''
let heldInterrupt = null

const thread = () => ({
  id: threadId,
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

function boundary(id) {
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

function recordInput(message) {
  const input = message.params.input
  const files = input
    .filter((item) => item.type === 'text' && item.text.startsWith('Attached file '))
    .map((item) => {
      const path = JSON.parse(item.text.slice(item.text.indexOf(': ') + 2))
      return { path, contents: readFileSync(path, 'utf8') }
    })
  record({ event: message.method, input, files })
}

function start(message) {
  turnId = `${threadId}-${process.pid}-${++turnCount}`
  recordInput(message)
  send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } })
  send({
    method: 'turn/started',
    params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
  })
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

function handle(message) {
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

function response(method) {
  switch (method) {
    case 'initialize':
      return {
        userAgent: 'Codex/0.154.0 verification',
        platformFamily: 'unix',
        platformOs: 'linux',
        codexHome: root,
      }
    case 'account/read':
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    case 'model/list':
      return {
        data: [
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'Queue verification',
            description: 'Isolated queue fixture',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          },
        ],
        nextCursor: null,
      }
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

record({ event: 'spawn', pid: process.pid })
process.on('exit', () => record({ event: 'exit', pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))
setInterval(control, 25)
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) handle(JSON.parse(line))
})
