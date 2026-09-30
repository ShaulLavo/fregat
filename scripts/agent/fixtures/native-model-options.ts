#!/usr/bin/env node
import {
  fixtureIO,
  trackLifecycle,
  codexInitialization,
  beginTurn,
  readRequests,
} from './runtime.ts'
import type { FixtureRequest } from './protocol.ts'
import { basename } from 'node:path'

const { root, record, send } = fixtureIO(import.meta.url)
const threadId = `${basename(root)}-thread`
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

function completeOptionsTurn(message: FixtureRequest) {
  const turnId = `${threadId}-${++turnNumber}`
  const text = message.params.input
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  record({ event: 'turn/start', pid: process.pid, params: message.params })
  beginTurn(send, message, threadId, turnId)
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

function optionsResult(message: FixtureRequest) {
  switch (message.method) {
    case 'initialize':
      return codexInitialization(root)
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

function handleOptionsRequest(message: FixtureRequest) {
  if (message.id === undefined) return
  if (message.method === 'turn/start') return completeOptionsTurn(message)
  const result = optionsResult(message)
  if (result !== undefined) return send({ id: message.id, result })
  send({
    id: message.id,
    error: { code: -32601, message: `Unsupported model-options fixture method ${message.method}` },
  })
}

trackLifecycle(record)
readRequests(handleOptionsRequest)
