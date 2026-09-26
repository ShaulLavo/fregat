#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const threadId = `${basename(root)}-thread`
const record = (entry) => appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify(entry)}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
let turnNumber = 0

const models = [
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'Options primary',
    description: 'Advertised effort and service tier verification',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Default effort' },
      { reasoningEffort: 'future-effort-v3', description: 'Provider-defined future effort' },
    ],
    defaultServiceTier: null,
    serviceTiers: [
      { id: 'priority', name: 'Priority', description: 'Priority fixture tier' },
      { id: 'flex', name: 'Flexible', description: 'Flexible fixture tier' },
    ],
  },
  {
    id: 'gpt-5.5-mini',
    model: 'gpt-5.5-mini',
    displayName: 'Options alternate',
    description: 'Disjoint model defaults verify selection reconciliation',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Alternate default effort' },
    ],
    defaultServiceTier: 'economy-v2',
    serviceTiers: [{ id: 'economy-v2', name: 'Economy v2', description: 'Alternate default tier' }],
  },
]

function optionsThread() {
  return {
    id: threadId,
    sessionId: threadId,
    projectId: null,
    cliVersion: 'verification',
    createdAt: 0,
    updatedAt: 0,
    cwd: process.cwd(),
    ephemeral: true,
    modelProvider: 'openai',
    preview: 'Model options verification',
    source: 'appServer',
    status: { type: 'idle' },
    turns: [],
  }
}

function completeOptionsTurn(message) {
  const turnId = `${threadId}-${++turnNumber}`
  const text = message.params.input
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  record({ event: 'turn/start', pid: process.pid, params: message.params })
  send({
    id: message.id,
    result: { turn: { id: turnId, status: 'inProgress', items: [] } },
  })
  send({
    method: 'turn/started',
    params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
  })
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: { id: `${turnId}-answer`, type: 'agentMessage', text: `ACK_${text}` },
    },
  })
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status: 'completed', items: [] } },
  })
}

function optionsResult(message) {
  switch (message.method) {
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
      record({ event: 'model/list', models })
      return { data: models, nextCursor: null }
    case 'thread/start':
    case 'thread/resume':
      record({ event: message.method, pid: process.pid, params: message.params })
      return {
        thread: optionsThread(),
        model: message.params.model ?? 'gpt-5.5',
        modelProvider: 'openai',
        cwd: process.cwd(),
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'dangerFullAccess' },
      }
    case 'thread/read':
      return { thread: optionsThread() }
    case 'thread/list':
      return { data: [], nextCursor: null }
    case 'skills/list':
      return { data: [] }
    default:
      return undefined
  }
}

function handleOptionsRequest(message) {
  if (message.id === undefined) return
  if (message.method === 'turn/start') return completeOptionsTurn(message)
  const result = optionsResult(message)
  if (result !== undefined) return send({ id: message.id, result })
  send({
    id: message.id,
    error: { code: -32601, message: `Unsupported model-options fixture method ${message.method}` },
  })
}

record({ event: 'spawn', pid: process.pid })
process.on('exit', () => record({ event: 'exit', pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) handleOptionsRequest(JSON.parse(line))
})
