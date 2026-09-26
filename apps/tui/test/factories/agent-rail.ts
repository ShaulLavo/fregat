import { InputRenderable, SelectRenderable } from '@opentui/core'
import { act } from 'react'
import { expect } from '../fixtures'
import { runPaletteCommand } from '../actions'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsSession } from '@/connection/state/session'
import type { TestServer } from '../server'
import * as v from 'valibot'
import {
  commandIdSchema,
  sessionIdSchema,
  worktreeIdSchema,
  DEFAULT_PROVIDER_INSTANCE_ID,
  type SessionWorktreeTarget,
  type WorktreeId,
  type WorktreePullRequest,
} from '@workspace/contracts'
import { orchestrationForApp } from 'server/testing'
import type { ChatOwner } from '@workspace/client-core/chat/owner'

export async function createRailSession(
  chat: ChatOwner,
  worktreeId: WorktreeId,
  title: string,
  worktreeTarget: SessionWorktreeTarget = { kind: 'current', worktreeId },
) {
  const sessionId = v.parse(sessionIdSchema, crypto.randomUUID())
  await chat.dispatch({
    type: 'session.create',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId,
    worktreeTarget,
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

export async function focusRailSession(
  frame: Awaited<ReturnType<typeof import('../render').renderTui>>,
  title: string,
) {
  await runPaletteCommand(frame, 'Filter sessions')
  const input = frame.renderer.currentFocusedRenderable
  if (!(input instanceof InputRenderable)) return expect.unreachable('Expected session filter')
  const length = input.value.length
  await act(async () => {
    frame.mockInput.pressKey('END')
    for (let index = 0; index < length; index++) frame.mockInput.pressKey('BACKSPACE')
    await frame.mockInput.typeText(title)
    frame.mockInput.pressEnter()
  })
  await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
  await act(async () => {
    frame.mockInput.pressArrow('down')
  })
  expect(
    (frame.renderer.currentFocusedRenderable as SelectRenderable).getSelectedOption()?.name,
  ).toContain(title)
}

/** A session in its own new worktree, with the pull request the forge answered for its branch. */
export async function createPullRequestRailSession(
  server: TestServer,
  chat: ChatOwner,
  baseWorktreeId: WorktreeId,
  title: string,
  pullRequest: WorktreePullRequest,
) {
  const worktreeId = v.parse(worktreeIdSchema, crypto.randomUUID())
  await createRailSession(chat, baseWorktreeId, title, {
    kind: 'new',
    worktreeId,
    baseWorktreeId,
  })
  const engine = orchestrationForApp(server.app)
  await expect
    .poll(async () => (await engine.readModelSnapshot()).worktrees.get(worktreeId)?.lifecycle.state)
    .toBe('ready')
  await engine.dispatch({
    type: 'worktree.pull-request.sync',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    worktreeId,
    branch: `worktree/${worktreeId}`,
    pullRequest,
  })
  await chat.refresh()
  return worktreeId
}
