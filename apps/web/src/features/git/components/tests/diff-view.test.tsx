import { getClient } from '@/lib/client'
import { fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import type { GitComparison } from '@/lib/documents/utils/types'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { fetchDiff } from '@/features/git/utils/api'
import { fetchBlobDiff } from '@/features/git/utils/blob-diff-query'
import { DiffView } from '@/features/git/components/diff-view'
import { useDiffDocumentDiffs } from '@/features/git/hooks/use-diff-document-diffs'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import { snapshotComparison } from '../../../../../test/factories/git-diff'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { gitFileDiff } from '../../../../../test/factories/git-diff'
import { expect, test } from '../../../../../test/fixtures'
import {
  createTestQueryClient,
  renderHookWithProviders,
  renderWithProviders,
} from '../../../../../test/render'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { runGit } from '../../../../../test/factories/git'

// Real Git and routes verify historical text; the browser scenario checks painted syntax.

const FORTY_LINES = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')

for (const kind of ['checkpoint-file', 'checkpoint-turn', 'checkpoint-session'] as const) {
  test(`${kind} loads complete saved blobs from a cached checkpoint patch`, async ({
    client,
    server,
  }) => {
    const repo = await initRepo(server.root)
    await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
    const patches = await fetchDiff('repo/lines.ts', false, undefined, client)
    const source = {
      owner: filesystemPath('repo'),
      sessionId: TEST_SESSION_ID,
      fromTurnCount: 0,
      toTurnCount: 1,
    }
    const comparison: GitComparison =
      kind === 'checkpoint-file'
        ? { ...source, kind, file: fileResource(filesystemPath('repo/lines.ts')) }
        : { ...source, kind }
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(diffDocumentQueryKey(comparison), patches)
    await writeFile(path.join(repo, 'lines.ts'), 'unrelated working copy\n')

    const { result } = renderHookWithProviders(() => useDiffDocumentDiffs(comparison), {
      queryClient,
    })
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.failure).toBeNull()
    expect(result.current.diffs[0]?.oldText).toBe(`${FORTY_LINES}\n`)
    expect(result.current.diffs[0]?.newText).toBe(twoEditFile())
    expect(editorDiffFiles(result.current.diffs)[0]?.isPartial).toBe(false)
  })
}

test('a two-edit file maps to one diff carrying both changes and the whole file', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
  const diffs = await fetchDiff('repo/lines.ts', false, undefined, getClient())

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
  const [diff] = await fetchDiff('repo/lines.ts', false, undefined, getClient())
  const withText = { ...diff!, newText: twoEditFile(), oldText: `${FORTY_LINES}\n` }

  const [file] = editorDiffFiles([withText])

  expect(file?.isPartial).toBe(false)
  expect(file?.newLines.length).toBe(41)
  expect(file?.languageId).toBe('typescript')
})

test('shows a comparison loader while the blob resolves', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'lines.ts'), twoEditFile())
  const [diff] = await fetchDiff('repo/lines.ts', false, undefined, getClient())

  const { container } = renderDiffView(
    <DiffView
      comparison={snapshotComparison(diff!)}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )

  expect(screen.getByRole('status', { name: 'Loading comparison' })).toBeInTheDocument()

  await waitFor(() => {
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })
  expect(container.querySelector('.editor-diff-pane')).not.toBeNull()
})

test('a rename with edits keeps both paths on the mapped file', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  runGit(repo, ['mv', 'lines.ts', 'renamed.ts'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'renamed.ts'), twoEditFile())
  runGit(repo, ['add', '-A'], { cwdMode: 'option' })
  const diffs = await fetchDiff('repo/renamed.ts', true, undefined, getClient())

  const [file] = editorDiffFiles(diffs)

  expect(file?.newPath).toContain('renamed.ts')
  expect(file?.oldPath).toContain('lines.ts')
  expect(file?.hunks.length).toBeGreaterThan(0)
})

test('an added file maps with no old side', async ({ client, server }) => {
  void client
  const repo = await initRepo(server.root)
  await writeFile(path.join(repo, 'added.ts'), 'export const added = true\n')
  runGit(repo, ['add', '-A'], { cwdMode: 'option' })
  const diffs = await fetchDiff('repo/added.ts', true, undefined, getClient())

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
  runGit(repo, ['mv', 'lines.ts', 'renamed.ts'], { cwdMode: 'option' })
  runGit(repo, ['add', '-A'], { cwdMode: 'option' })
  const diff = (await fetchDiff('repo/renamed.ts', true, undefined, getClient()))[0]!

  renderDiffView(
    <DiffView
      comparison={snapshotComparison(diff)}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
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
  runGit(repo, ['mv', 'lines.ts', 'renamed.ts'], { cwdMode: 'option' })
  runGit(repo, ['add', '-A'], { cwdMode: 'option' })
  const diff = (await fetchDiff('repo/renamed.ts', true, undefined, getClient()))[0]!

  // What the pane itself fetches: the blob route, which is where an identical pair used to come
  // back as nothing at all.
  const diffs = await fetchBlobDiff(
    {
      newObjectId: diff.newObjectId,
      oldObjectId: diff.oldObjectId,
      oldPath: diff.oldPath,
      path: diff.path,
    },
    undefined,
    getClient(),
  )
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
  const objectId = runGit(repo, ['hash-object', '-w', 'logo.png'], {
    cwdMode: 'option',
  }).stdout.trim()
  const documentInfo = snapshotComparison({
    ...gitFileDiff({ path: 'repo/logo.png' }),
    newObjectId: objectId,
  })

  renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
  )

  expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
})

test('a document whose two sides are identical still shows the file', async ({
  client,
  server,
}) => {
  void client
  const repo = await initRepo(server.root)
  const objectId = runGit(repo, ['rev-parse', 'HEAD:lines.ts'], { cwdMode: 'option' }).stdout.trim()
  const documentInfo = snapshotComparison({
    ...gitFileDiff({ oldObjectId: objectId, path: 'repo/lines.ts' }),
    newObjectId: objectId,
  })

  renderDiffView(
    <DiffView
      comparison={documentInfo}
      languageHost={testDiffLanguageHost}
      rootPath={filesystemPath('repo')}
    />,
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

async function initRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'lines.ts'), `${FORTY_LINES}\n`)
  runGit(repo, ['add', 'lines.ts'], { cwdMode: 'option' })
  runGit(repo, ['commit', '-m', 'init'], { cwdMode: 'option' })

  return repo
}
