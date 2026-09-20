#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const root = dirname(fileURLToPath(import.meta.url))
const threadId = `title-thread-${process.pid}`
let turnNumber = 0
const record = (entry) => appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify(entry)}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const thread = () => ({
  id: threadId,
  cliVersion: 'verification',
  createdAt: 0,
  updatedAt: 0,
  cwd: process.cwd(),
  ephemeral: true,
  modelProvider: 'openai',
  preview: 'Title verification',
  source: 'appServer',
  status: { type: 'idle' },
  turns: [],
})
const control = () => JSON.parse(readFileSync(join(root, 'title-control.json'), 'utf8'))
const held = new Map()
record({ event: 'spawn', pid: process.pid })
process.on('exit', () => record({ event: 'exit', pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))
function finish(turnId, text) {
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: { id: `${turnId}-answer`, type: 'agentMessage', text },
    },
  })
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status: 'completed', items: [] } },
  })
  record({ event: 'title-turn-completed', pid: process.pid, turnId })
}
setInterval(() => {
  if (!held.size || control().mode === 'hold') return
  for (const [turnId, text] of held) {
    held.delete(turnId)
    finish(turnId, text)
  }
}, 50)
function titleResponse(mode) {
  if (mode.mode === 'invalid') return 'invalid title JSON'
  return JSON.stringify({ title: mode.title, needsRefinement: false })
}
function handle(message) {
  if (message.id === undefined) return
  let result = {}
  switch (message.method) {
    case 'initialize':
      result = {
        userAgent: 'Codex/0.154.0 verification',
        platformFamily: 'unix',
        platformOs: 'linux',
        codexHome: root,
      }
      break
    case 'account/read':
      result = { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
      break
    case 'model/list':
      result = {
        data: [
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'Title fixture',
            description: 'Isolated title protocol fixture',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          },
        ],
        nextCursor: null,
      }
      break
    case 'thread/start':
    case 'thread/resume':
      result = {
        thread: thread(),
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cwd: process.cwd(),
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'dangerFullAccess' },
      }
      break
    case 'thread/read':
      result = { thread: thread() }
      break
    case 'thread/list':
      result = { data: [], nextCursor: null }
      break
    case 'skills/list':
      result = { data: [] }
      break
    case 'turn/start': {
      const turnId = `${threadId}-${++turnNumber}`
      const isTitle = JSON.stringify(message.params).includes(
        'Conversation contents (reference data):',
      )
      const mode = control()
      let text = 'TITLE_CONVERSATION_READY'
      if (isTitle) text = titleResponse(mode)
      send({
        id: message.id,
        result: { turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        method: 'turn/started',
        params: {
          threadId,
          turn: { id: turnId, status: 'inProgress', items: [] },
        },
      })
      record({
        event: isTitle ? 'title-request' : 'conversation-request',
        pid: process.pid,
        mode: mode.mode,
        interactionMode: message.params.collaborationMode?.mode,
        turnId,
      })
      if (mode.usage)
        send({
          method: 'thread/tokenUsage/updated',
          params: {
            threadId,
            turnId,
            tokenUsage: {
              total: {
                inputTokens: 1000,
                cachedInputTokens: 0,
                outputTokens: 100,
                reasoningOutputTokens: 0,
                totalTokens: 1100,
              },
              last: {
                inputTokens: 1000,
                cachedInputTokens: 0,
                outputTokens: 100,
                reasoningOutputTokens: 0,
                totalTokens: 1100,
              },
              modelContextWindow: 10000,
            },
          },
        })
      if ((isTitle || mode.holdConversation) && mode.mode === 'hold') {
        held.set(turnId, text)
        return
      }
      finish(turnId, text)
      return
    }
    case 'turn/interrupt':
      for (const turnId of held.keys()) {
        held.delete(turnId)
        send({
          method: 'turn/completed',
          params: {
            threadId,
            turn: { id: turnId, status: 'interrupted', items: [] },
          },
        })
      }
      break
    default:
      send({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported title fixture method ${message.method}`,
        },
      })
      return
  }
  send({ id: message.id, result })
}
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) handle(JSON.parse(line))
})
