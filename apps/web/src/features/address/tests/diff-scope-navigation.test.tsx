import { environmentIdSchema, scopedSessionKey, turnIdSchema } from '@workspace/contracts'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import {
  AMBIGUOUS_SESSION,
  DOMAIN_SESSION,
  TERMINAL_SESSION,
} from '../../../../test/factories/session-domain'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'

test('changing an automatic session diff scope pins its session and applies the scope', async () => {
  const { domain, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  await domain.dispatch({
    type: 'session.archive',
    commandId: 'archive-newest',
    sessionId: AMBIGUOUS_SESSION,
  })
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.setMode('chat')
  expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
  expect(navigation.currentAddress().document).toBeNull()
  const ref = { environmentId, sessionId: DOMAIN_SESSION }
  const scope = {
    kind: 'turn',
    turnId: v.parse(turnIdSchema, 'chosen-turn'),
    filePath: null,
  } as const
  expect(
    await navigation.setDiffScope(scope, { environmentId, sessionId: AMBIGUOUS_SESSION }),
  ).toEqual({ status: 'superseded' })
  expect(await navigation.setDiffScope(scope, ref)).toEqual({ status: 'applied' })
  expect(useSessionSelectionStore.getState().selection).toMatchObject({ kind: 'session', ...ref })
  expect(
    useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(ref)]?.scope,
  ).toEqual(scope)
  expect(navigation.router.history.location.href).toContain(`/chat/t/${DOMAIN_SESSION}`)
  expect(navigation.currentAddress().diff).toBe('chosen-turn')
  expect(await navigation.setDiffScope({ kind: 'working-tree' }, ref)).toEqual({
    status: 'applied',
  })
  expect(
    useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(ref)]?.scope,
  ).toEqual({ kind: 'working-tree' })
  expect(navigation.currentAddress().diff).toBe('wt')
})

test('diff scope rejects another environment, project or session while retaining the selected session', async () => {
  const { domain, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  await mkdir(path.join(domain.server.root, 'other'))
  const other = (await domain.register('register-other', 'other')).result
  if (!other) return expect.unreachable('other project registration is missing')
  expect(other.projectId).not.toBe(registration.projectId)
  await domain.createSession(other.worktreeId, TERMINAL_SESSION)
  await refresh()
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  const href = navigation.router.history.location.href
  const wrongRefs = [
    { environmentId, sessionId: AMBIGUOUS_SESSION },
    { environmentId, sessionId: TERMINAL_SESSION },
    {
      environmentId: v.parse(environmentIdSchema, 'd7b4079f-a895-42df-b472-ed1785c7cc54'),
      sessionId: DOMAIN_SESSION,
    },
  ]
  for (const ref of wrongRefs) {
    expect(await navigation.setDiffScope({ kind: 'working-tree' }, ref)).toEqual({
      status: 'superseded',
    })
    expect(navigation.router.history.location.href).toBe(href)
  }
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    kind: 'session',
    environmentId,
    sessionId: DOMAIN_SESSION,
  })
  expect(
    await navigation.setDiffScope(
      { kind: 'working-tree' },
      { environmentId, sessionId: DOMAIN_SESSION },
    ),
  ).toEqual({ status: 'applied' })
})

test('a scope callback from the automatic session cannot supersede a newer session preparation', async () => {
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let blockShell = false
  const { domain, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture({
      beforeRequest: async (request) => {
        if (!blockShell || new URL(request.url).pathname !== '/orchestration/shell-snapshot') return
        started.resolve()
        await released.promise
      },
    })
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await refresh()
  await navigation.openWorkspace({ environmentId, path: 'main' })
  await navigation.setMode('chat')
  expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  blockShell = true
  const pending = navigation.openChat({
    environmentId,
    sessionId: AMBIGUOUS_SESSION,
    surface: 'main',
  })
  try {
    await started.promise
    expect(
      await navigation.setDiffScope(
        { kind: 'turn', turnId: v.parse(turnIdSchema, 'stale-turn'), filePath: null },
        { environmentId, sessionId: DOMAIN_SESSION },
      ),
    ).toEqual({ status: 'superseded' })
    expect(navigation.getSnapshot().status).toBe('pending')
    released.resolve()
    expect(await pending).toEqual({ status: 'applied' })
    expect(navigation.currentAddress().document).toBe(`t/${AMBIGUOUS_SESSION}`)
    expect(navigation.currentAddress().diff).not.toBe('stale-turn')
  } finally {
    released.resolve()
  }
})
