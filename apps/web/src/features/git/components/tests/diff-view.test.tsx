import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { fetchDiff } from '@/features/git/utils/api'
import { fetchBlobDiff } from '@/features/git/utils/blob-diff-query'
import { DiffView } from '@/features/git/components/diff-view'
import { parseDiffDocumentId, snapshotDiffDocumentId } from '@/features/git/utils/diff-document'
import type {
  DiffDocumentInfo,
  SnapshotDiffDocumentInput,
} from '@/features/git/utils/diff-document'
import type { FileDiff } from '@/features/git/utils/types'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { gitFileDiff } from '../../../../../test/factories/git-diff'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

// Real git, real repository, real routes. Rendering belongs to the editor's
// virtualized diff view, which draws to a canvas and cannot be asserted in
// happy-dom — so what is checked here is the model we hand it, plus the
// non-renderable cases the pane still answers for itself.

const FORTY_LINES = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')

test('a two-edit file maps to one diff carrying both changes and the whole file', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
  const diffs = await fetchDiff('repo/lines.ts', false)

  const [file] = editorDiffFiles(diffs)

  expect(file?.hunks.length).toBe(2)
  expect(file?.newLines).toContain('line two')
  expect(file?.oldLines).toContain('line 2')
  // The plain diff route sends no file text, so the model can only be the
  // patch's own hunks. `isPartial` is what tells the view it cannot expand.
  expect(file?.isPartial).toBe(true)
})

test('whole-file text produces an expandable, fully-typed model', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
  // What the git panel actually opens: the blob-diff route carries both sides'
  // text, which is what lets the reader expand past git's context and what the
  // syntax pass needs to highlight a whole file rather than one with holes.
  const [diff] = await fetchDiff('repo/lines.ts', false)
  const withText = { ...diff!, newText: twoEditFile(), oldText: `${FORTY_LINES}\n` }

  const [file] = editorDiffFiles([withText])

  expect(file?.isPartial).toBe(false)
  expect(file?.newLines.length).toBe(41)
  expect(file?.languageId).toBe('typescript')
})

test('keeps the diff editor mounted with an empty model while the blob resolves', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
  const [diff] = await fetchDiff('repo/lines.ts', false)

  const { container } = renderDiffView(
    <DiffView
      documentInfo={snapshotDocument(diff!)}
      languageHost={testDiffLanguageHost}
      rootPath='repo'
    />,
  )

  expect(container.querySelector('.editor-diff-pane')).not.toBeNull()
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Editor input"]')?.value).toBe(
    '',
  )
  expect(screen.queryByRole('status', { name: 'Loading diff' })).not.toBeInTheDocument()

  await waitFor(() => {
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })
  expect(container.querySelector('.editor-diff-pane')).not.toBeNull()
})

test('a rename with edits keeps both paths on the mapped file', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  git(repo, 'mv', 'lines.ts', 'renamed.ts')
  await writeFile(path.join(repo, 'renamed.ts'), twoEditFile())
  git(repo, 'add', '-A')
  const diffs = await fetchDiff('repo/renamed.ts', true)

  const [file] = editorDiffFiles(diffs)

  expect(file?.newPath).toContain('renamed.ts')
  expect(file?.oldPath).toContain('lines.ts')
  expect(file?.hunks.length).toBeGreaterThan(0)
})

test('an added file maps with no old side', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'added.ts'), 'export const added = true\n')
  git(repo, 'add', '-A')
  const diffs = await fetchDiff('repo/added.ts', true)

  const [file] = editorDiffFiles(diffs)

  expect(file?.oldLines).toEqual([])
  expect(file?.newLines).toContain('export const added = true')
})

test('a pure rename shows the file, with a line saying where it came from', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  git(repo, 'mv', 'lines.ts', 'renamed.ts')
  git(repo, 'add', '-A')
  const diff = (await fetchDiff('repo/renamed.ts', true))[0]!

  renderDiffView(
    <DiffView
      documentInfo={snapshotDocument(diff)}
      languageHost={testDiffLanguageHost}
      rootPath='repo'
    />,
  )

  expect(await screen.findByText(/Renamed from lines\.ts/)).toBeInTheDocument()
  // The rows themselves are drawn by the editor's virtualized view, so what is checked here is
  // that the pane got a file to draw rather than the notice that used to replace it.
  expect(screen.queryByText(/No changes to show/)).not.toBeInTheDocument()
  expect(document.querySelector('.editor-diff-pane')).not.toBeNull()
})

test('a pure rename carries the whole file, unchanged on both sides', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  git(repo, 'mv', 'lines.ts', 'renamed.ts')
  git(repo, 'add', '-A')
  const diff = (await fetchDiff('repo/renamed.ts', true))[0]!

  // What the pane itself fetches: the blob route, which is where an identical pair used to come
  // back as nothing at all.
  const diffs = await fetchBlobDiff({
    newObjectId: diff.newObjectId,
    oldObjectId: diff.oldObjectId,
    oldPath: diff.oldPath,
    path: diff.path,
  })
  const [file] = editorDiffFiles(diffs)

  expect(file?.hunks).toEqual([])
  expect(file?.isPartial).toBe(false)
  expect(file?.newLines).toContain('line 40')
  expect(file?.oldLines).toEqual(file?.newLines)
})

test('a binary file says so instead of rendering an empty pane', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'logo.png'), Buffer.from([0, 1, 2, 0, 3, 255, 0, 9]))
  const objectId = git(repo, 'hash-object', '-w', 'logo.png').trim()
  const documentInfo = snapshotDocument({
    ...gitFileDiff({ path: 'repo/logo.png' }),
    newObjectId: objectId,
  })

  renderDiffView(
    <DiffView documentInfo={documentInfo} languageHost={testDiffLanguageHost} rootPath='repo' />,
  )

  expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
})

test('a document whose two sides are identical still shows the file', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  const objectId = git(repo, 'rev-parse', 'HEAD:lines.ts').trim()
  const documentInfo = snapshotDocument({
    ...gitFileDiff({ oldObjectId: objectId, path: 'repo/lines.ts' }),
    newObjectId: objectId,
  })

  renderDiffView(
    <DiffView documentInfo={documentInfo} languageHost={testDiffLanguageHost} rootPath='repo' />,
  )

  expect(await screen.findByText('No content changes')).toBeInTheDocument()
  expect(screen.queryByText('No changes to show.')).not.toBeInTheDocument()
})

/** The diff pane reads `diffViewMode` from the editor workspace store, which the
 *  workbench always provides around it. */
function renderDiffView(ui: ReactElement) {
  // The real provider, not a bare workspace store: a diff asks for editor commands now — it
  // opens a file when a definition lands outside it — and those need the whole editor store stack.
  return renderWithProviders(<EditorStateProvider>{ui}</EditorStateProvider>)
}

function twoEditFile() {
  return `${FORTY_LINES.replace('line 2\n', 'line two\n').replace('line 35\n', 'thirty five\n')}\n`
}

function snapshotDocument(diff: FileDiff): DiffDocumentInfo {
  const info = parseDiffDocumentId(snapshotDiffDocumentId(diff as SnapshotDiffDocumentInput))
  expect(info).not.toBeNull()

  return info!
}

async function initRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  await writeFile(path.join(repo, 'lines.ts'), `${FORTY_LINES}\n`)
  git(repo, 'add', 'lines.ts')
  git(repo, 'commit', '-m', 'init')

  return repo
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}
