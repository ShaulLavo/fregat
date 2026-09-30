#!/usr/bin/env node
import {
  fixtureIO,
  trackLifecycle,
  codexModels,
  codexResponse,
  beginTurn,
  readRequests,
} from './runtime.ts'
import type { FixtureRequest, TitleControl } from './protocol.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { root, record, send } = fixtureIO(import.meta.url)
const threadId = `title-thread-${process.pid}`
let turnNumber = 0
const thread = () => ({
  id: threadId,
  sessionId: threadId,
  projectId: null,
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
const control = (): TitleControl =>
  JSON.parse(readFileSync(join(root, 'title-control.json'), 'utf8'))
const held = new Map<string, string>()
trackLifecycle(record)
function finish(turnId: string, text: string) {
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
function titleResponse(mode: TitleControl) {
  if (mode.mode === 'invalid') return 'invalid title JSON'
  return JSON.stringify({ title: mode.title, needsRefinement: false })
}
function handle(message: FixtureRequest) {
  if (message.id === undefined) return
  const response = codexResponse(message.method, root, thread, () =>
    codexModels('Title fixture', 'Isolated title protocol fixture'),
  )
  if (response !== undefined) return send({ id: message.id, result: response })
  let result = {}
  switch (message.method) {
    case 'turn/start': {
      const turnId = `${threadId}-${++turnNumber}`
      const isTitle = JSON.stringify(message.params).includes(
        'Conversation contents (reference data):',
      )
      const mode = control()
      let text = 'TITLE_CONVERSATION_READY'
      if (isTitle) text = titleResponse(mode)
      beginTurn(send, message, threadId, turnId)
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
readRequests(handle)
