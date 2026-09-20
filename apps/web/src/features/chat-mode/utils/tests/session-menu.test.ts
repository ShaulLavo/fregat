import type { SessionRuntimeState, SessionRuntimeStatus } from '@workspace/contracts'
import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  canStopAgentSession,
  sessionMenu,
  type SessionMenuContext,
} from '@/features/chat-mode/utils/session-menu'
import type { MenuActionItem, MenuItem } from '@/keymap/menus/utils/model'
import { expect, test } from '../../../../../test/fixtures'

test('offers open and a new session in the same project first', () => {
  expect(itemLabels(menuContext(), 'open')).toEqual(['Open', 'New Session in This Project'])
})

test('groups rename, archive, and delete after the open section', () => {
  expect(sectionIds(menuContext())).toEqual(['open', 'edit', 'copy', 'project', 'agent'])
  expect(itemLabels(menuContext(), 'edit')).toEqual(['Rename', 'Archive', 'Delete'])
})

test('an archived session offers unarchive in archive’s place, never both', () => {
  expect(itemLabels(menuContext({ archived: true }), 'edit')).toEqual([
    'Rename',
    'Unarchive',
    'Delete',
  ])
})

test('delete is the only destructive item', () => {
  const destructive = actionsIn(menuContext())
    .filter((item) => item.destructive)
    .map((item) => item.label)

  expect(destructive).toEqual(['Delete'])
})

test('offers to narrow the list to the session’s project', () => {
  expect(itemLabels(menuContext(), 'project')).toEqual(['Show Only This Project'])
})

test('omits the scope item when the list already shows only that project', () => {
  expect(itemLabels(menuContext({ scopedToProject: true }), 'project')).toEqual([])
})

test('offers to stop the agent only while a session is live', () => {
  expect(itemLabels(menuContext({ canStopAgent: true }), 'agent')).toEqual(['Stop Agent Session'])
  expect(itemLabels(menuContext(), 'agent')).toEqual([])
})

test('every item runs its own callback', () => {
  const calls: string[] = []
  const context = menuContext({
    archived: true,
    canStopAgent: true,
    record: calls,
  })
  for (const item of actionsIn(context)) {
    item.run()
  }

  expect(calls).toEqual([
    'open',
    'newSession',
    'rename',
    'unarchive',
    'deleteSession',
    'copyPath',
    'copySessionId',
    'scopeToProject',
    'stopAgent',
  ])
})

test('a live agent session can be stopped in every state that still holds a process', () => {
  const stoppable: SessionRuntimeStatus[] = [
    'idle',
    'starting',
    'running',
    'waiting',
    'ready',
    'interrupted',
  ]

  expect(stoppable.map((status) => canStopAgentSession(session(status)))).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
  ])
})

test('a stopped or failed session has nothing left to stop', () => {
  expect(canStopAgentSession(session('stopped'))).toBe(false)
  expect(canStopAgentSession(session('error'))).toBe(false)
})

test('a session that never started a session cannot be stopped', () => {
  expect(canStopAgentSession(null)).toBe(false)
  expect(canStopAgentSession(undefined)).toBe(false)
})

function actionsIn(context: SessionMenuContext, sectionId?: string) {
  return sessionMenu(context)
    .filter((entry) => !sectionId || entry.id === sectionId)
    .flatMap((entry) => entry.items)
    .filter(isActionItem)
}

function isActionItem(item: MenuItem | null | false): item is MenuActionItem {
  if (!item) return false

  return item.kind === 'action'
}

function sectionIds(context: SessionMenuContext) {
  return sessionMenu(context).map((entry) => entry.id)
}

function itemLabels(context: SessionMenuContext, sectionId: string) {
  return actionsIn(context, sectionId).map((item) => item.label)
}

function menuContext({
  archived = false,
  canStopAgent = false,
  record = [],
  scopedToProject = false,
  titleGeneration,
}: {
  archived?: boolean
  canStopAgent?: boolean
  record?: string[]
  scopedToProject?: boolean
  titleGeneration?: SessionMenuContext['titleGeneration']
} = {}): SessionMenuContext {
  return {
    copyPath: () => record.push('copyPath'),
    copyBranch: null,
    copySessionId: () => record.push('copySessionId'),
    canMarkUnread: false,
    woke: false,
    markUnread: () => record.push('markUnread'),
    acknowledgeWake: () => record.push('acknowledgeWake'),
    archive: () => record.push('archive'),
    archived,
    canStopAgent,
    deleteSession: () => record.push('deleteSession'),
    newSession: () => record.push('newSession'),
    open: () => record.push('open'),
    rename: () => record.push('rename'),
    scopedToProject,
    titleGeneration,
    scopeToProject: () => record.push('scopeToProject'),
    stopAgent: () => record.push('stopAgent'),
    unarchive: () => record.push('unarchive'),
  }
}

function session(status: SessionRuntimeStatus): SessionRuntimeState {
  return {
    activeTurnId: null,
    lastError: null,
    providerName: 'mock',
    providerBindingHandle: null,
    providerConversationMarker: null,
    providerResumeCursor: null,
    runtimeEpoch: 'test',
    runtimeMode: 'approval-required',
    status,
    sessionId: v.parse(sessionIdSchema, '09415529-5ee5-5ad1-a96c-092eac1e03bf'),
    updatedAt: '2026-05-09T00:00:00.000Z',
  }
}

test('completed read sessions can be marked unread and wakes explicitly acknowledged', () => {
  const calls: string[] = []
  const context = {
    ...menuContext({ record: calls }),
    canMarkUnread: true,
    woke: true,
  }
  const actions = actionsIn(context, 'edit')
  expect(actions.map((item) => item.label)).toContain('Mark as unread')
  expect(actions.map((item) => item.label)).toContain('Acknowledge wake')
  actions.find((item) => item.id === 'markUnread')?.run()
  actions.find((item) => item.id === 'acknowledgeWake')?.run()
  expect(calls).toEqual(['markUnread', 'acknowledgeWake'])
})

test('copy branch exists only for a known owner branch', () => {
  expect(itemLabels(menuContext(), 'copy')).toEqual(['Copy Path', 'Copy Session ID'])
  expect(itemLabels({ ...menuContext(), copyBranch: () => {} }, 'copy')).toEqual([
    'Copy Path',
    'Copy Branch',
    'Copy Session ID',
  ])
})

test('title regeneration remains available in archives and exposes pending and retry states', () => {
  const generation = {
    supported: true,
    pending: false,
    requesting: false,
    error: null,
    regenerate() {},
  }
  expect(
    itemLabels(menuContext({ archived: true, titleGeneration: generation }), 'edit'),
  ).toContain('Regenerate title')
  const pending = actionsIn(
    menuContext({ titleGeneration: { ...generation, pending: true } }),
  ).find((item) => item.id === 'regenerateTitle')
  expect(pending).toMatchObject({ label: 'Regenerating…', disabled: true })
  expect(
    itemLabels(
      menuContext({
        titleGeneration: { ...generation, error: 'Provider unavailable' },
      }),
      'edit',
    ),
  ).toContain('Retry title generation')
  expect(
    actionsIn(menuContext({ titleGeneration: { ...generation, supported: false } })).some(
      (item) => item.id === 'regenerateTitle',
    ),
  ).toBe(false)
})
