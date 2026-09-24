import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import {
  resetComposerInboxStore,
  useComposerInboxStore,
} from '@/features/chat/state/composer-inbox-store'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { fetchDiff } from '@/features/git/utils/api'
import { DiffView } from '@/features/git/components/diff-view'
import { snapshotComparison } from '../../../../../test/factories/git-diff'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { saveSettings } from '@/features/settings/utils/api'
import { editorRowPoint, stubEditorViewport } from '../../../../../test/env/editor-viewport'

// Real git, real routes, and the editor's real diff view, which answers where a
// press landed through `diffRowAtEvent`. Only the CSS Custom Highlight API is stubbed —
// happy-dom has none, and the diff view registers a selection highlight on mount.

const FORTY_LINES = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')

test.beforeEach(() => {
  stubEditorViewport()
})

test('a range dragged in the new pane reaches the composer addressed to the new side', async ({
  client,
  server,
}) => {
  void client
  const { documentInfo } = await twoEditRepo(server.root)
  await renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )

  await dragRows('new', 0, 2)

  expect(await screen.findByText('new lines 1-3, old lines 1-3')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Ask the agent about these lines/ }))

  expect(queuedText()).toContain('About `repo/lines.ts`, new lines 1-3, old lines 1-3:')
  expect(queuedText()).toContain('-line 2')
  expect(queuedText()).toContain('+line two')
})

test('the same rows dragged in the old pane are addressed to the old side', async ({
  client,
  server,
}) => {
  void client
  const { documentInfo } = await twoEditRepo(server.root)
  await renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )

  // Row 1 of the old pane is the deletion; the new pane's row 1 is the addition.
  await dragRows('old', 1, 1)

  expect(await screen.findByText('old line 2')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Ask the agent about these lines/ }))

  const text = queuedText()
  expect(text).toContain('About `repo/lines.ts`, old line 2:')
  expect(text).toContain('@@ -2,1 +0,0 @@')
  expect(text).toContain('-line 2')
  expect(text).not.toContain('+line two')
})

test('a row still addresses its own line after the skipped range above it is expanded', async ({
  client,
  server,
}) => {
  void client
  const { documentInfo } = await twoEditRepo(server.root, { alsoEditLine35: true })
  await renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )
  await waitFor(() => expect(paneRows('new').length).toBeGreaterThan(6))

  const separator = paneRows('new').findIndex((row) =>
    row.classList.contains('editor-diff-row-expandable'),
  )
  expect(separator).toBeGreaterThan(0)
  const separatorRow = paneRows('new')[separator]!
  await userEvent.pointer({
    coords: editorRowPoint(separatorRow),
    keys: '[MouseLeft]',
    target: separatorRow,
  })
  await dragRows('new', separator + 1, separator + 1)

  // The row after the separator was line 32 before the expansion and is line 6
  // after it; reading the collapsed projection here is the silent wrong-line
  // failure the expansion mirror prevents.
  expect(await screen.findByText('new line 6, old line 6')).toBeInTheDocument()
})

test('dismissing a selection takes the offer back without attaching anything', async ({
  client,
  server,
}) => {
  void client
  const { documentInfo } = await twoEditRepo(server.root)
  await renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )

  await dragRows('new', 0, 2)
  await userEvent.click(await screen.findByRole('button', { name: 'Dismiss line selection' }))

  expect(screen.queryByRole('button', { name: /Ask the agent about these lines/ })).toBeNull()
  expect(useComposerInboxStore.getState().pending).toEqual([])
})

function queuedText() {
  const [entry] = useComposerInboxStore.getState().pending
  expect(entry?.kind).toBe('text')

  return entry?.kind === 'text' ? entry.text : ''
}

type PaneSide = 'new' | 'old' | 'stacked'

function paneRows(side: PaneSide) {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `.editor-diff-pane-${side} [data-editor-virtual-row]:not([hidden])`,
    ),
  ]
}

async function dragRows(side: PaneSide, anchorRow: number, headRow: number) {
  await waitFor(() => expect(paneRows(side).length).toBeGreaterThan(headRow))

  const rows = paneRows(side)
  pressRow(rows[anchorRow], 'mousedown')
  pressRow(rows[headRow], 'mouseup')
}

// The line comment finds rows by point query, so each press carries its row's coordinates.
function pressRow(row: HTMLElement | undefined, type: 'mousedown' | 'mouseup') {
  if (!row) return

  row.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...editorRowPoint(row) }))
}

async function renderDiffView(ui: ReactElement) {
  stubHighlightApi()
  resetComposerInboxStore()
  await saveSettings(
    {
      mutationId: 'diff-comments-split',
      operations: [{ key: 'editor.diff.viewMode', kind: 'set', value: 'split' }],
      target: 'user',
    },
    getClient(),
  )

  return renderWithProviders(<EditorStateProvider>{ui}</EditorStateProvider>)
}

function stubHighlightApi() {
  class HighlightStub extends Set<unknown> {}
  Object.assign(globalThis, { Highlight: HighlightStub })
  Object.assign(globalThis.CSS ?? {}, { highlights: new Map() })
}

async function twoEditRepo(root: string, { alsoEditLine35 = false } = {}) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  await writeFile(path.join(repo, 'lines.ts'), `${FORTY_LINES}\n`)
  git(repo, 'add', 'lines.ts')
  git(repo, 'commit', '-m', 'init')
  const edited = FORTY_LINES.replace('line 2\n', 'line two\n')
  const text = alsoEditLine35 ? edited.replace('line 35\n', 'thirty five\n') : edited
  await writeFile(path.join(repo, 'lines.ts'), `${text}\n`)
  const diff = (await fetchDiff('repo/lines.ts', false, undefined, getClient()))[0]!

  return { documentInfo: snapshotComparison(diff), repo }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}
