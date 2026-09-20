import { chatWorktree } from '../../../../test/factories/chat'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { scopedSessionKey, scopedProjectKey } from '@workspace/contracts'
import { projectIdSchema, sessionIdSchema } from '@workspace/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import * as v from 'valibot'
import { vi } from 'vitest'

import { quickAccessFilter, quickAccessMode } from '@/features/command-palette/utils/query'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { SessionGroups } from '@/features/command-palette/components/session-groups'
import type { SessionRailItem, SessionRailProject } from '@workspace/client-core/chat/rail/model'
import { Command, CommandInput, CommandList } from '@workspace/ui/components/command'
import { expect, test } from '../../../../test/fixtures'

const platformId = v.parse(projectIdSchema, 'fcad4a69-3e68-5de2-8303-a2c1ebe8f60c')
const siteId = v.parse(projectIdSchema, '9b1fd4f4-7ba9-5967-87f0-3efd01bbc4d5')
const railSessionId = v.parse(sessionIdSchema, '5e84cb50-b170-5280-aaba-14c8bebda2db')
const footerSessionId = v.parse(sessionIdSchema, '9916594d-2e09-584d-a570-d93eb168900b')

test('the sess prefix puts the palette in session mode', () => {
  expect(quickAccessMode('sess footer')).toBe('sessions')
})

test('finds a session by its title and opens it', async () => {
  const actions = renderSessionPalette()

  await userEvent.type(screen.getByRole('combobox'), 'sess footer')

  expect(screen.getByText('Fix the footer')).toBeVisible()
  expect(screen.queryByText('Ship the rail')).toBeNull()

  await userEvent.click(screen.getByText('Fix the footer'))

  expect(actions.selectSession).toHaveBeenCalledWith(
    expect.objectContaining({ id: footerSessionId }),
  )
})

test('offers a new session in a project the query names', async () => {
  const actions = renderSessionPalette()

  await userEvent.type(screen.getByRole('combobox'), 'sess site')

  // The project row is the one carrying the workspace root.
  await userEvent.click(screen.getByText('/repo/site'))

  expect(actions.startSessionDraft).toHaveBeenCalledWith({
    environmentId: TEST_ENVIRONMENT_ID,
    projectId: siteId,
  })
})

function renderSessionPalette() {
  const actions = commandPaletteActions()

  render(
    <CommandPaletteActionsProvider actions={actions}>
      {/* The real palette's own filter and prefix handling — a stubbed filter here
          would prove nothing about whether typing a title finds the session. */}
      <Command filter={quickAccessFilter} shouldFilter>
        <CommandInput />
        <CommandList>
          <SessionGroups projects={sessionProjects()} sessions={sessionItems()} />
        </CommandList>
      </Command>
    </CommandPaletteActionsProvider>,
  )

  return actions
}

function CommandPaletteActionsProvider({
  actions,
  children,
}: {
  readonly actions: CommandPaletteActions
  readonly children: ReactNode
}) {
  return <CommandPaletteActionsContext value={actions}>{children}</CommandPaletteActionsContext>
}

function commandPaletteActions(): CommandPaletteActions {
  return {
    disabledReasonForCommand: vi.fn(() => null),
    previewColorTheme: vi.fn(),
    selectColorTheme: vi.fn(),
    selectContent: () => Promise.resolve(),
    selectFile: vi.fn(),
    selectPlatformCommand: vi.fn(),
    selectScript: vi.fn(),
    selectSession: vi.fn(),
    selectGotoLine: vi.fn(),
    selectSymbol: vi.fn(),
    startSessionDraft: vi.fn(),
  }
}

function sessionItems(): readonly SessionRailItem[] {
  return [
    sessionItem(railSessionId, 'Ship the rail', platformId, 'platform'),
    sessionItem(footerSessionId, 'Fix the footer', siteId, 'site'),
  ]
}

function sessionItem(
  id: typeof railSessionId,
  title: string,
  projectId: typeof platformId,
  projectTitle: string,
): SessionRailItem {
  return {
    ref: { environmentId: TEST_ENVIRONMENT_ID, sessionId: id },
    key: scopedSessionKey({ environmentId: TEST_ENVIRONMENT_ID, sessionId: id }),
    environmentId: TEST_ENVIRONMENT_ID,
    machineLabel: null,
    stale: false,
    placement: 'active',
    canReorder: false,
    canDrag: false,
    settledOrderAt: null,
    activeOrderKey: null,
    unsettledAt: null,
    pinnedAt: null,
    snoozedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    projectGroupKey: projectId,
    attentionReason: null,
    hasError: false,
    activityAt: '2026-05-09T00:00:00.000Z',
    archived: false,
    origin: 'platform',
    branch: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    id,
    pinOrderKey: null,
    projectId,
    projectTitle,
    status: 'ready',
    title,
    unread: false,
    worktreePath: '/repo/platform',
    worktree: chatWorktree(),
    repositoryKind: 'git',
  }
}

function sessionProjects(): readonly SessionRailProject[] {
  return [
    {
      groupKey: 'platform',
      members: [],
      sessionRefs: [],
      active: true,
      ref: { environmentId: TEST_ENVIRONMENT_ID, projectId: platformId },
      key: scopedProjectKey({ environmentId: TEST_ENVIRONMENT_ID, projectId: platformId }),
      createdAt: '2026-05-01T00:00:00Z',
      id: platformId,
      orderKey: null,
      qualifier: null,
      sessionCount: 1,
      status: 'ready',
      title: 'platform',
      unreadCount: 0,
      workspaceRoot: '/repo/platform',
    },
    {
      groupKey: 'site',
      members: [],
      sessionRefs: [],
      active: false,
      ref: { environmentId: TEST_ENVIRONMENT_ID, projectId: siteId },
      key: scopedProjectKey({ environmentId: TEST_ENVIRONMENT_ID, projectId: siteId }),
      createdAt: '2026-05-01T00:00:00Z',
      id: siteId,
      orderKey: null,
      qualifier: null,
      sessionCount: 1,
      status: 'ready',
      title: 'site',
      unreadCount: 0,
      workspaceRoot: '/repo/site',
    },
  ]
}
