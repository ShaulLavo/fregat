import assert from 'node:assert/strict'
import * as v from 'valibot'
import { orchestrationForApp, type MockProviderAdapter } from 'server/testing'
import {
  commandIdSchema,
  messageIdSchema,
  orchestrationWsClientMessageSchema,
  orchestrationWsServerMessageSchema,
  type SessionId,
} from '@workspace/contracts'
import type { createControlledInProcessTransport } from '../client'
import { DEFAULT_PROVIDER_INSTANCE_ID, type WorktreeId } from '@workspace/contracts'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'

import { createTestSettingsSession } from './session'
import type { TestServer } from '../server'

export async function openTestChat(
  server: TestServer,
  options: Parameters<typeof createTestSettingsSession>[1] = {},
) {
  const session = createTestSettingsSession(server, options)
  await session.refresh()
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  return { session, chat: ready.chat }
}

export function draftChatTurn(worktreeId: WorktreeId, text = 'Say hello') {
  return createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    text,
    modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
    worktreeTarget: { kind: 'current', worktreeId },
  })
}

// Title generation sends ephemeral turns through the same adapter; these are the user's.
export function conversationTurns(adapter: MockProviderAdapter) {
  return adapter.startedTurns.filter((turn) => !turn.ephemeral)
}

export async function appendChatMessages(
  server: TestServer,
  { sessionId, count }: { readonly sessionId: SessionId; readonly count: number },
) {
  const engine = orchestrationForApp(server.app)
  assert(engine)
  const startedAt = Date.now()
  for (let index = 0; index < count; index += 1) {
    await engine.dispatch({
      type: 'session.message.assistant.delta',
      commandId: v.parse(commandIdSchema, `history-command-${index}`),
      sessionId,
      messageId: v.parse(messageIdSchema, `history-message-${index}`),
      delta: `Message ${index}`,
      createdAt: new Date(startedAt + index).toISOString(),
    })
  }
}

export function loseNextDispatchAcknowledgement(
  transport: ReturnType<typeof createControlledInProcessTransport>,
) {
  const socket = transport.sockets.at(-1)
  assert(socket)
  let requestId: string | null = null
  const send = socket.send.bind(socket)
  const deliver = socket.deliver.bind(socket)
  socket.send = (raw) => {
    const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw))
    if (message.kind === 'request' && message.method === 'dispatchCommand') {
      requestId = message.requestId
      socket.send = send
    }
    send(raw)
  }
  socket.deliver = (raw) => {
    const message = v.parse(orchestrationWsServerMessageSchema, raw)
    if (message.kind === 'response' && message.requestId === requestId) {
      socket.deliver = deliver
      socket.serverClose({ code: 1006, wasClean: false })
      return
    }
    deliver(raw)
  }
}
