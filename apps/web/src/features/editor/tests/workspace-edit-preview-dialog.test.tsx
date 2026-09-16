import { filesystemPath } from '@/lib/documents/utils/identity'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { WorkspaceEditPreviewDialog } from '@/features/editor/components/workspace-edit-preview-dialog'
import { WorkspaceEditRecoveryDialog } from '@/features/editor/components/workspace-edit-recovery-dialog'
import { WorkspaceEditServiceContext } from '@/features/editor/providers/workspace-edit-context'
import type {
  WorkspaceEditPreview,
  WorkspaceEditRecovery,
  WorkspaceEditService,
  WorkspaceEditServiceSnapshot,
} from '@/features/editor/state/workspace-edit-service'
import { FocusService } from '@/lib/focus/state/service'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const RECOVERY: WorkspaceEditRecovery = {
  affectedPaths: ['src/already-restored.ts', 'src/remaining.ts', 'package.json'].map(
    filesystemPath,
  ),
  generation: 7,
  operationId: '10000000-0000-4000-8000-000000000063',
  unrecoveredPaths: ['src/remaining.ts', 'package.json'].map(filesystemPath),
}

test('shows ordered diffs and dirty open unopened and resource labels', () => {
  const harness = new DialogServiceHarness(awaitingSnapshot())
  renderDialogs(harness)

  const dialog = screen.getByRole('dialog', { name: 'Update project files' })
  const rows = within(within(dialog).getByRole('list')).getAllByRole('listitem')
  const operationLabels = [
    'Edit text',
    'Edit text',
    'Edit text',
    'Create file',
    'Rename file',
    'Delete file',
    'Create file',
  ]
  const targetLabels = [
    'dirty',
    'open',
    'unopened',
    'create',
    'rename',
    'delete',
    'ignored / no-op',
  ]

  expect(rows).toHaveLength(operationLabels.length)
  for (const [index, label] of operationLabels.entries()) {
    expect(rows[index]).toHaveTextContent(label)
    expect(rows[index]).toHaveTextContent(targetLabels[index]!)
  }
  expect(rows[0]).toHaveTextContent('let count = 1')
  expect(rows[0]).toHaveTextContent('let count = 2')
  expect(rows[1]).toHaveTextContent('export const open = false')
  expect(rows[1]).toHaveTextContent('export const open = true')
  expect(rows[2]).toHaveTextContent('unopened before')
  expect(rows[2]).toHaveTextContent('unopened after')
  expect(rows[4]).toHaveTextContent('/repo/src/old.ts → /repo/src/renamed.ts')
  expect(within(dialog).getByText('7 operations')).toHaveClass('tabular-nums')
  expect(dialog).toHaveTextContent(
    'Open buffers remain unsaved. Unopened files and resource operations are written.',
  )
  expect(dialog).toHaveTextContent(
    "Undo this group with Undo workspace edit, or from the file's History tab.",
  )
})

test('groups and confirms needsConfirmation annotations', () => {
  const harness = new DialogServiceHarness(
    awaitingSnapshot({
      annotations: [
        {
          description: 'Safe mechanical rewrite',
          id: 'format',
          label: 'Format imports',
          needsConfirmation: false,
        },
        {
          description: 'Updates package metadata',
          id: 'metadata',
          label: 'Security-sensitive edit',
          needsConfirmation: true,
        },
      ],
    }),
  )
  renderDialogs(harness)

  const safe = screen.getByText('Format imports')
  const guarded = screen.getByText('Security-sensitive edit')
  const annotationGroup = guarded.closest('div[class*="border-warning"]')

  expect(annotationGroup).not.toBeNull()
  expect(annotationGroup).toContainElement(safe)
  expect(safe.parentElement).toHaveTextContent('Format imports — Safe mechanical rewrite')
  expect(safe.parentElement).not.toHaveTextContent('confirmation required')
  expect(guarded.parentElement).toHaveTextContent(
    'Security-sensitive edit — Updates package metadata — confirmation required',
  )
})

test('offers only all-or-nothing confirmation with no file or hunk selectors', () => {
  const harness = new DialogServiceHarness(awaitingSnapshot())
  renderDialogs(harness)

  const dialog = screen.getByRole('dialog', { name: 'Update project files' })
  const buttons = within(dialog)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim())

  expect(buttons).toEqual(['Cancel', 'Apply all'])
  expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
  expect(dialog.querySelectorAll('input, select')).toHaveLength(0)
})

test('cancel restores focus and settles the producer as cancelled', async () => {
  const user = userEvent.setup()
  const focus = new FocusService()
  const opener = document.createElement('button')
  opener.textContent = 'Request code action'
  document.body.append(opener)
  opener.focus()
  const registration = focus.register({
    area: 'global',
    element: opener,
    id: { kind: 'app-shell' },
    onIntent: (_intent, element) => {
      element.focus()
      return true
    },
  })
  const harness = new DialogServiceHarness(idleSnapshot())

  try {
    renderDialogs(harness, focus)
    act(() => harness.setSnapshot(awaitingSnapshot()))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await expect(harness.producerSettlement).resolves.toEqual({ status: 'cancelled' })
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(harness.cancelPreview).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000063')
  } finally {
    registration.unregister()
    opener.remove()
  }
})

test('apply uses Spinner and disables cancel after commit begins', async () => {
  const user = userEvent.setup()
  const harness = new DialogServiceHarness(awaitingSnapshot())
  renderDialogs(harness)

  await user.click(screen.getByRole('button', { name: 'Apply all' }))

  const apply = screen.getByRole('button', { name: 'Apply all' })
  expect(harness.confirmPreview).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000063')
  expect(apply).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(apply.querySelector('svg[aria-label="Loading"]')).not.toBeNull()
  expect(screen.getByText('Applying atomic change…')).toBeInTheDocument()
})

test('a stale preview disables apply and explains rerun', () => {
  const harness = new DialogServiceHarness(
    workspaceSnapshot({ phase: 'stale', preview: workspacePreview() }),
  )
  renderDialogs(harness)

  expect(screen.getByText('This preview is stale. Request the edit again.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply all' })).toBeDisabled()
})

test('partial recovery lists exact relative paths and no undo action', () => {
  const harness = new DialogServiceHarness(recoverySnapshot())
  renderDialogs(harness)

  const dialog = screen.getByRole('dialog', { name: 'Workspace recovery required' })
  const paths = within(dialog)
    .getAllByRole('listitem')
    .map((item) => item.textContent)

  expect(paths).toEqual(['src/remaining.ts', 'package.json'])
  expect(within(dialog).getByText('2 unrecovered paths')).toHaveClass('tabular-nums')
  expect(within(dialog).queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  expect(within(dialog).queryByText(/workspace undo/i)).not.toBeInTheDocument()
})

test('restores the recovery surface after reload and retries only remaining compensation', async () => {
  const user = userEvent.setup()
  const harness = new DialogServiceHarness(recoverySnapshot())
  renderDialogs(harness)

  const dialog = screen.getByRole('dialog', { name: 'Workspace recovery required' })
  expect(within(dialog).queryByText('src/already-restored.ts')).not.toBeInTheDocument()
  expect(within(dialog).getByText('src/remaining.ts')).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: 'Retry recovery' }))

  expect(harness.retryRecovery).toHaveBeenCalledOnce()
  expect(screen.getByText('Retrying exact recovery…')).toBeInTheDocument()
})

test('requires separate exact-path confirmation before discarding partial recovery data', async () => {
  const user = userEvent.setup()
  const harness = new DialogServiceHarness(recoverySnapshot())
  renderDialogs(harness)

  await user.click(screen.getByRole('button', { name: 'Discard recovery data' }))
  expect(harness.discardRecoveryData).not.toHaveBeenCalled()

  const confirmation = screen.getByRole('dialog', { name: 'Discard rollback data?' })
  expect(confirmation).toHaveTextContent(
    'Files may remain changed. This only deletes the rollback data and cannot prove that the workspace was restored.',
  )
  expect(
    within(confirmation)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['src/remaining.ts', 'package.json'])

  await user.click(within(confirmation).getByRole('button', { name: 'Discard exact paths' }))
  expect(harness.discardRecoveryData).toHaveBeenCalledWith(['src/remaining.ts', 'package.json'])
})

test('discard warns then leaves affected live buffers in recovery conflict with Save disabled', async () => {
  const user = userEvent.setup()
  const harness = new DialogServiceHarness(recoverySnapshot(), { retainRecoveryAfterDiscard: true })
  renderDialogs(harness)

  await user.click(screen.getByRole('button', { name: 'Discard recovery data' }))
  const confirmation = screen.getByRole('dialog', { name: 'Discard rollback data?' })
  expect(confirmation).toHaveTextContent('Files may remain changed.')
  await user.click(within(confirmation).getByRole('button', { name: 'Discard exact paths' }))

  expect(await screen.findByText('Recovery conflict')).toBeInTheDocument()
  expect(screen.getByText('src/remaining.ts')).toBeInTheDocument()
  expect(screen.getByText(/Save and resource operations are disabled/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save affected buffers' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Continue with conflicted buffers' }))

  expect(harness.dismissResult).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog', { name: 'Recovery conflict' })).not.toBeInTheDocument()
})

test('dismissal never releases a partial journal', async () => {
  const user = userEvent.setup()
  const harness = new DialogServiceHarness(recoverySnapshot())
  renderDialogs(harness)

  await user.keyboard('{Escape}')

  expect(screen.getByRole('dialog', { name: 'Workspace recovery required' })).toBeInTheDocument()
  expect(harness.discardRecoveryData).not.toHaveBeenCalled()
  expect(harness.retryRecovery).not.toHaveBeenCalled()
  expect(harness.getSnapshot().recovery).toEqual(RECOVERY)
})

test('uses distinct loading and empty verdict states', () => {
  const harness = new DialogServiceHarness(workspaceSnapshot({ phase: 'preparing' }))
  renderDialogs(harness)

  expect(screen.getByRole('status', { name: 'Preparing workspace edit preview' })).toHaveAttribute(
    'data-slot',
    'loading-state',
  )
  expect(screen.queryByText('No workspace changes')).not.toBeInTheDocument()

  act(() => {
    harness.setSnapshot(awaitingSnapshot({ operationCount: 0, rows: [] }))
  })

  expect(
    screen.queryByRole('status', { name: 'Preparing workspace edit preview' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('No workspace changes')).toBeInTheDocument()
})

type DialogHarnessOptions = {
  readonly retainRecoveryAfterDiscard?: boolean
}

class DialogServiceHarness {
  private readonly listeners = new Set<() => void>()
  private resolveProducer!: (result: { readonly status: 'cancelled' }) => void
  private snapshot: WorkspaceEditServiceSnapshot

  readonly producerSettlement = new Promise<{ readonly status: 'cancelled' }>((resolve) => {
    this.resolveProducer = resolve
  })

  readonly cancelPreview = vi.fn(() => {
    this.setSnapshot(workspaceSnapshot({ phase: 'cancelled' }))
    this.resolveProducer({ status: 'cancelled' })
  })

  readonly confirmPreview = vi.fn(() => {
    this.setSnapshot(workspaceSnapshot({ phase: 'committing', preview: this.snapshot.preview }))
  })

  readonly discardRecoveryData = vi.fn(async (_paths: readonly string[]) => {
    this.setSnapshot(
      workspaceSnapshot({
        phase: 'released',
        recovery: this.options.retainRecoveryAfterDiscard ? this.snapshot.recovery : null,
      }),
    )
    return true
  })

  readonly getSnapshot = (): WorkspaceEditServiceSnapshot => this.snapshot

  readonly dismissResult = vi.fn(() => {
    this.setSnapshot(workspaceSnapshot({ phase: 'idle' }))
  })

  readonly retryRecovery = vi.fn(async () => {
    this.setSnapshot(workspaceSnapshot({ phase: 'recovering', recovery: this.snapshot.recovery }))
    return true
  })

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  constructor(
    snapshot: WorkspaceEditServiceSnapshot,
    private readonly options: DialogHarnessOptions = {},
  ) {
    this.snapshot = snapshot
  }

  asService(): WorkspaceEditService {
    return this as unknown as WorkspaceEditService
  }

  setSnapshot(snapshot: WorkspaceEditServiceSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

function renderDialogs(harness: DialogServiceHarness, focusService?: FocusService): void {
  renderWithProviders(
    <WorkspaceEditServiceContext value={harness.asService()}>
      <WorkspaceEditPreviewDialog />
      <WorkspaceEditRecoveryDialog />
    </WorkspaceEditServiceContext>,
    { command: false, focusService },
  )
}

function idleSnapshot(): WorkspaceEditServiceSnapshot {
  return workspaceSnapshot({ phase: 'idle' })
}

function awaitingSnapshot(
  previewOverrides: Partial<WorkspaceEditPreview> = {},
): WorkspaceEditServiceSnapshot {
  return workspaceSnapshot({
    canCancel: true,
    phase: 'awaiting-confirmation',
    preview: workspacePreview(previewOverrides),
  })
}

function recoverySnapshot(): WorkspaceEditServiceSnapshot {
  return workspaceSnapshot({
    code: 'workspace-edit-recovery-required',
    message: 'Some workspace paths still need recovery.',
    phase: 'recovery-required',
    recovery: RECOVERY,
  })
}

function workspaceSnapshot(
  overrides: Partial<WorkspaceEditServiceSnapshot>,
): WorkspaceEditServiceSnapshot {
  return {
    canCancel: false,
    canRedo: false,
    canUndo: false,
    code: null,
    message: null,
    phase: 'idle',
    preview: null,
    recovery: null,
    ...overrides,
  }
}

function workspacePreview(overrides: Partial<WorkspaceEditPreview> = {}): WorkspaceEditPreview {
  return {
    annotations: [],
    label: 'Update project files',
    operationCount: 7,
    operationId: '10000000-0000-4000-8000-000000000063',
    rows: [
      {
        afterText: 'let count = 2',
        annotationIds: [],
        beforeText: 'let count = 1',
        ignored: false,
        index: 0,
        kind: 'text-document',
        path: filesystemPath('/repo/src/dirty.ts'),
        targetKind: 'dirty',
      },
      {
        afterText: 'export const open = true',
        annotationIds: [],
        beforeText: 'export const open = false',
        ignored: false,
        index: 1,
        kind: 'text-document',
        path: filesystemPath('/repo/src/open.ts'),
        targetKind: 'open',
      },
      {
        afterText: 'unopened after',
        annotationIds: [],
        beforeText: 'unopened before',
        ignored: false,
        index: 2,
        kind: 'text-document',
        path: filesystemPath('/repo/src/unopened.ts'),
        targetKind: 'unopened',
      },
      {
        annotationIds: [],
        ignored: false,
        index: 3,
        kind: 'create',
        path: filesystemPath('/repo/src/new.ts'),
      },
      {
        annotationIds: [],
        fromPath: filesystemPath('/repo/src/old.ts'),
        ignored: false,
        index: 4,
        kind: 'rename',
        path: filesystemPath('/repo/src/old.ts'),
        toPath: filesystemPath('/repo/src/renamed.ts'),
      },
      {
        annotationIds: [],
        ignored: false,
        index: 5,
        kind: 'delete',
        path: filesystemPath('/repo/src/removed.ts'),
      },
      {
        annotationIds: [],
        ignored: true,
        index: 6,
        kind: 'create',
        path: filesystemPath('/repo/src/already-there.ts'),
      },
    ],
    undoCategory: 'workspace',
    ...overrides,
  }
}
