import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsSession } from '@/connection/state/session'
import type { TestServer } from '../server'
import * as v from 'valibot'
import {
  commandIdSchema,
  sessionIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  type WorktreeId,
} from '@workspace/contracts'
import type { ChatOwner } from '@workspace/client-core/chat/owner'

export async function createRailSession(chat: ChatOwner, worktreeId: WorktreeId, title: string) {
  const sessionId = v.parse(sessionIdSchema, crypto.randomUUID())
  await chat.dispatch({
    type: 'session.create',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId },
    title,
    modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
    runtimeMode: 'full-access',
    interactionMode: 'default',
  })
  return sessionId
}

export async function createRailProjects({
  session,
  chat,
  server,
}: {
  readonly session: SettingsSession
  readonly chat: ChatOwner
  readonly server: TestServer
}) {
  await mkdir(join(server.root, 'alpha'))
  await mkdir(join(server.root, 'beta'))
  const alpha = await session.ensureWorktree('alpha')
  const beta = await session.ensureWorktree('beta')
  await chat.refresh()
  await createRailSession(chat, alpha, 'Alpha conversation')
  const sessionId = await createRailSession(chat, beta, 'Beta conversation')
  const projectId = chat.getSnapshot().projection.worktreeById[beta]?.projectId
  assert(projectId)
  return { alpha, beta, sessionId, projectId }
}
