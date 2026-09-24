import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

import { AssistantChangedFilesSection } from '@/features/chat/components/assistant-changed-files-section'
import {
  ChatTimelineActionsContext,
  type ChatTimelineActions,
} from '@/features/chat/providers/timeline-actions-context'
import {
  hydrateChatChangedFilesExpansionStoreFromStorage,
  resetChatChangedFilesExpansionStore,
} from '@/features/chat/state/chat-changed-files-expansion-store'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { turnDiffSummary } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const openedDiffs: (string | undefined)[] = []

function manyFiles(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    additions: 3,
    deletions: 1,
    kind: 'modified',
    path: index % 2 === 0 ? `apps/web/file-${index}.ts` : `packages/ui/file-${index}.ts`,
  }))
}

function card(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-changed-files-state]')
}

function renderSection(summary: ChatTurnDiffSummary) {
  return renderWithProviders(withProviders(<AssistantChangedFilesSection summary={summary} />))
}

function withProviders(children: ReactNode) {
  const actions: ChatTimelineActions = {
    openCheckpointDiff: (_summary, path?: string) => void openedDiffs.push(path),
    openSessionCheckpointDiff: () => undefined,
    revertToCheckpoint: () => undefined,
  }

  return (
    <ChatTransportContext value={unsupportedChatTransport()}>
      <ChatTimelineActionsContext value={actions}>{children}</ChatTimelineActionsContext>
    </ChatTransportContext>
  )
}

beforeEach(() => {
  openedDiffs.length = 0
  localStorage.clear()
  resetChatChangedFilesExpansionStore()
  hydrateChatChangedFilesExpansionStoreFromStorage(testScopedStorage)
})

afterEach(() => {
  localStorage.clear()
  resetChatChangedFilesExpansionStore()
})

test('a small turn opens inline so the change is readable without a click', () => {
  const { container } = renderSection(turnDiffSummary())

  expect(card(container)?.dataset.changedFilesState).toBe('expanded')
  expect(screen.getByText('a.ts')).toBeInTheDocument()
})

test('a many-file turn stays collapsed behind a scope summary', () => {
  const { container } = renderSection(turnDiffSummary({ files: manyFiles(40) }))

  expect(card(container)?.dataset.changedFilesState).toBe('preview')
  expect(screen.getByRole('button', { name: /40 changed files/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  expect(container.textContent).toContain('apps')
  expect(container.textContent).toContain('packages')
  expect(screen.queryByText('file-39.ts')).not.toBeInTheDocument()
})

test('the collapsed preview expands the whole tree on request', async () => {
  const user = userEvent.setup()
  const { container } = renderSection(turnDiffSummary({ files: manyFiles(40) }))

  await user.click(screen.getByRole('button', { name: 'Show all 40 files' }))

  expect(card(container)?.dataset.changedFilesState).toBe('expanded')
  expect(screen.getByText('file-39.ts')).toBeInTheDocument()
})

test('a preview file opens its own diff without expanding the card', async () => {
  const user = userEvent.setup()
  const { container } = renderSection(turnDiffSummary({ files: manyFiles(40) }))

  await user.click(screen.getByRole('button', { name: 'file-0.ts' }))

  expect(openedDiffs).toEqual(['apps/web/file-0.ts'])
  expect(card(container)?.dataset.changedFilesState).toBe('preview')
})

test('the expanded state survives a reload', async () => {
  const user = userEvent.setup()
  const summary = turnDiffSummary({ files: manyFiles(40) })
  const first = renderSection(summary)

  await user.click(screen.getByRole('button', { name: 'Show all 40 files' }))
  first.unmount()

  // A fresh page load: in-memory state gone, storage read back.
  resetChatChangedFilesExpansionStore()
  hydrateChatChangedFilesExpansionStoreFromStorage(testScopedStorage)

  const { container } = renderSection(summary)
  expect(card(container)?.dataset.changedFilesState).toBe('expanded')
})

test('the diff stat stays compact and keeps the exact counts in its name', () => {
  renderSection(
    turnDiffSummary({
      files: [{ additions: 12_480, deletions: 4, kind: 'modified', path: 'src/a.ts' }],
    }),
  )

  expect(screen.getAllByLabelText('12480 additions, 4 deletions')[0]).toHaveTextContent('+12k')
  expect(screen.queryByText('+12480')).not.toBeInTheDocument()
})

test('each file names its checkpoint change the way the Turn panel does', () => {
  renderSection(
    turnDiffSummary({
      files: [
        { additions: 4, deletions: 0, kind: 'added', path: 'src/new.ts' },
        { additions: 0, deletions: 9, kind: 'deleted', path: 'src/old.ts' },
        { additions: 0, deletions: 0, kind: 'renamed', path: 'src/moved.ts' },
        { additions: 1, deletions: 1, kind: 'type-changed', path: 'src/odd.ts' },
      ],
    }),
  )

  const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(name) })
  expect(row('new.ts')).toHaveTextContent(/A$/)
  expect(row('old.ts')).toHaveTextContent(/D$/)
  expect(row('moved.ts')).toHaveTextContent(/R$/)
  expect(row('odd.ts')).toHaveTextContent(/M$/)
  expect(row('moved.ts')).toHaveAttribute('title', 'src/moved.ts · Historical renamed')
})

test('a missing or failed checkpoint with no files still says so', () => {
  const { rerender } = renderSection(turnDiffSummary({ files: [], status: 'missing' }))
  expect(screen.getByText('Checkpoint missing for turn 1')).toBeInTheDocument()

  rerender(
    withProviders(
      <AssistantChangedFilesSection summary={turnDiffSummary({ files: [], status: 'error' })} />,
    ),
  )
  expect(screen.getByText('Checkpoint error for turn 1')).toBeInTheDocument()
})

test('a turn that changed nothing adds nothing to the transcript', () => {
  const { container } = renderSection(turnDiffSummary({ files: [] }))

  expect(container.querySelector('[data-changed-files-state]')).toBeNull()
})

test('an available checkpoint that later fails drops its diff actions and names the error', () => {
  const { rerender } = renderSection(turnDiffSummary())
  expect(screen.getByRole('button', { name: 'View diff' })).toBeInTheDocument()

  rerender(
    withProviders(<AssistantChangedFilesSection summary={turnDiffSummary({ status: 'error' })} />),
  )

  expect(screen.queryByRole('button', { name: 'View diff' })).not.toBeInTheDocument()
  expect(screen.getByText('Checkpoint error for turn 1')).toBeInTheDocument()
})
