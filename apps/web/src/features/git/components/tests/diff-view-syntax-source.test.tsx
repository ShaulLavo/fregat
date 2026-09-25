import { Editor } from '@singapore-editor/core/editor'
import type { DocumentTextSnapshot } from '@singapore-editor/core/document'
import {
  createEmptySyntaxResult,
  toEditorTokenStore,
  type EditorSyntaxSessionOptions,
  type EditorToken,
  type EditorTokenInput,
} from '@singapore-editor/core/syntax'
import type { TreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'
import type { GitFileDiff } from '@workspace/contracts'
import { screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { onTestFinished, vi } from 'vitest'

import { DiffView } from '@/features/git/components/diff-view'
import { fetchDiff } from '@/features/git/utils/api'
import { saveSettings } from '@/features/settings/utils/api'
import { blobDiffQueryKey, fetchBlobDiff } from '@/features/git/utils/blob-diff-query'
import { diffDocumentQueryKey } from '@/features/git/utils/diff-document-query'
import {
  editorShikiHighlighterProvider,
  editorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import type { Client } from '@/lib/client'
import { fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import type { GitComparison } from '@/lib/documents/utils/types'
import { gitKeys } from '@/lib/query-keys'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

// Diff syntax reads a row's tokens from source line N of each side. A checkpoint patch skips the
// lines between hunks, so parsing it as a whole file paints each row with another line's tokens.

type Kind = 'checkpoint-file' | 'checkpoint-turn' | 'checkpoint-session'
type Painted = { readonly text: string; readonly tokens: readonly EditorToken[] }

const PARTIAL_NOTICE = /Changed lines only/
const PARSED_COLOR = 'rgb(1, 2, 3)'

for (const kind of ['checkpoint-file', 'checkpoint-turn', 'checkpoint-session'] as const) {
  test(`${kind} parses the displayed file's complete blob pair and colours each row from its own line`, async ({
    client,
    server,
  }) => {
    const repo = await initRepo(server.root)
    const [first, second] = await editBoth(repo, client)
    const listed = kind === 'checkpoint-file' ? [second] : [first, second]
    const displayed = listed[0]!
    const view = await renderCheckpoint(kind, listed)

    await waitFor(() => expect(view.tokenCount()).toBeGreaterThan(0))
    expect(view.misplacedTokens()).toEqual([])
    const name = displayed === first ? 'first' : 'second'
    expect(view.parsedSources().sort()).toEqual(
      [`${lines(name).join('\n')}\n`, `${editedLines(name).join('\n')}\n`].sort(),
    )
    // A turn lists every file; only the displayed one loads its whole contents.
    expect(view.blobQueries()).toBe(1)
    expect(screen.queryByText(PARTIAL_NOTICE)).toBeNull()
  })
}

test('a checkpoint entry with no blob pair draws its changed lines without parsing them', async ({
  client,
  server,
}) => {
  const repo = await initRepo(server.root)
  const [, second] = await editBoth(repo, client)
  const view = await renderCheckpoint('checkpoint-file', [
    { ...second, newObjectId: undefined, oldObjectId: undefined },
  ])

  await expectPatchOnly(view)
})

test('a side without an object id is never diffed against an empty file', async ({
  client,
  server,
}) => {
  const repo = await initRepo(server.root)
  const [, second] = await editBoth(repo, client)
  const view = await renderCheckpoint('checkpoint-file', [{ ...second, oldObjectId: undefined }])

  await expectPatchOnly(view)
})

test('a blob pair sent without its text draws the checkpoint patch without parsing it', async ({
  client,
  server,
}) => {
  const repo = await initRepo(server.root)
  const [, second] = await editBoth(repo, client)
  const request = {
    newObjectId: second.newObjectId,
    oldObjectId: second.oldObjectId,
    oldPath: second.oldPath,
    path: second.path,
  }
  // The server's answer for a pair over its text limit: the patch and ids, no text.
  const answer = (await fetchBlobDiff(request, undefined, client)).map(
    ({ newText: _newText, oldText: _oldText, ...rest }) => rest,
  )
  const view = await renderCheckpoint('checkpoint-file', [second], (queryClient) =>
    queryClient.setQueryData(blobDiffQueryKey(request), answer),
  )

  await expectPatchOnly(view)
})

test('an unavailable blob pair still shows the checkpoint patch, uncoloured', async ({
  client,
  server,
}) => {
  const repo = await initRepo(server.root)
  const [, second] = await editBoth(repo, client)
  const view = await renderCheckpoint('checkpoint-file', [
    { ...second, newObjectId: 'f'.repeat(40), oldObjectId: 'e'.repeat(40) },
  ])

  await expectPatchOnly(view)
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

test('split view colours a whitespace-only context line in the old pane from the text it draws', async ({
  client,
  server,
}) => {
  const repo = await initRepo(server.root)
  // Line 3 is re-indented next to the line 5 edit; `git diff -w` prints it as context.
  const edited = editedLines('second').map((text, index) => (index === 2 ? `    ${text}` : text))
  await writeFile(path.join(repo, 'second.ts'), `${edited.join('\n')}\n`)
  const [entry] = await fetchDiff('repo/second.ts', false, undefined, client)
  const patch = git(repo, 'diff', '--ignore-all-space', '--', 'second.ts')
  await writeFile(path.join(repo, 'second.ts'), 'unrelated working copy\n')
  await useSplitView(client)
  const view = await renderCheckpoint('checkpoint-file', [{ ...entry!, patch }])

  await waitFor(() => expect(view.paintedText()).toContain(`    ${sourceLine('second', 3)}`))
  await waitFor(() => expect(view.tokenCount()).toBeGreaterThan(0))
  await settleSyntax()
  expect(view.misplacedTokens()).toEqual([])
})

for (const change of ['added', 'deleted'] as const) {
  test(`a checkpoint entry for a ${change} file parses only the side that exists`, async ({
    client,
    server,
  }) => {
    const repo = await initRepo(server.root)
    const entry = await stagedEntry(repo, client, change)
    const view = await renderCheckpoint('checkpoint-file', [entry])

    await waitFor(() => expect(view.tokenCount()).toBeGreaterThan(0))
    expect(view.misplacedTokens()).toEqual([])
    // The missing side has no rows; diff syntax parses it as the empty file it is.
    expect(view.parsedSources().filter(Boolean)).toEqual([`${lines(change).join('\n')}\n`])
    expect(screen.queryByText(PARTIAL_NOTICE)).toBeNull()
  })
}

async function expectPatchOnly(view: RenderedCheckpoint) {
  await waitFor(() => expect(view.paintedText()).toContain(editedLine(30)))
  await settleSyntax()
  expect(view.misplacedTokens()).toEqual([])
  expect(view.parsedSources()).toEqual([])
  expect(screen.getByText(PARTIAL_NOTICE)).toBeInTheDocument()
}

/** A parse that was going to land has landed by now; the stub answers in a microtask. */
async function settleSyntax() {
  await new Promise((resolve) => setTimeout(resolve, 200))
}

type RenderedCheckpoint = Awaited<ReturnType<typeof renderCheckpoint>>

async function renderCheckpoint(
  kind: Kind,
  listed: readonly GitFileDiff[],
  seed?: (queryClient: ReturnType<typeof createTestQueryClient>) => void,
) {
  stubHighlightApi()
  const painted = new Map<Editor, Painted>()
  const parsed: string[] = []
  recordPaint(painted)
  stubParsers(parsed)
  const comparison = checkpointComparison(kind, listed[0]!.path)
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(diffDocumentQueryKey(comparison), listed)
  seed?.(queryClient)

  renderWithProviders(
    <EditorStateProvider>
      <DiffView
        comparison={comparison}
        languageHost={testDiffLanguageHost}
        rootPath={filesystemPath('repo')}
      />
    </EditorStateProvider>,
    { queryClient },
  )

  const panes = () => [...painted.values()]
  return {
    blobQueries: () =>
      queryClient.getQueryCache().findAll({ queryKey: [...gitKeys.diffs(), 'blob'] }).length,
    misplacedTokens: () => panes().flatMap(misplacedTokens),
    paintedText: () =>
      panes()
        .map((pane) => pane.text)
        .join('\n'),
    parsedSources: () => [...new Set(parsed)],
    tokenCount: () => panes().reduce((count, pane) => count + parsedTokens(pane).length, 0),
  }
}

/** Both diff syntax backends parse through the stub, whichever the active theme selects. */
function stubParsers(parsed: string[]) {
  const record = (text: DocumentTextSnapshot) => {
    const source = text.readRange(0, text.length)
    parsed.push(source)
    return firstWordTokens(source)
  }
  const treeSitter = vi
    .spyOn(editorTreeSitterSyntaxProvider(), 'createSession')
    .mockImplementation(
      (options) =>
        firstWordSession(options, record(options.textSnapshot)) as ReturnType<
          TreeSitterSyntaxProvider['createSession']
        >,
    )
  const shiki = vi
    .spyOn(editorShikiHighlighterProvider(), 'createSession')
    .mockImplementation((options) => {
      const tokens = toEditorTokenStore(record(options.textSnapshot))
      return {
        applyChange: async () => ({ tokens }),
        dispose: () => undefined,
        refresh: async () => ({ tokens }),
      }
    })
  onTestFinished(() => {
    treeSitter.mockRestore()
    shiki.mockRestore()
  })
}

/** Each pane's latest buffer text and the tokens applied over it. */
function recordPaint(painted: Map<Editor, Painted>) {
  const setText = Editor.prototype.setText
  const setTokens = Editor.prototype.setTokens
  const textSpy = vi.spyOn(Editor.prototype, 'setText').mockImplementation(function (
    this: Editor,
    ...args: Parameters<Editor['setText']>
  ) {
    painted.set(this, { text: args[0], tokens: tokenList(args[1]?.tokens ?? []) })
    return setText.apply(this, args)
  })
  const tokensSpy = vi.spyOn(Editor.prototype, 'setTokens').mockImplementation(function (
    this: Editor,
    ...args: Parameters<Editor['setTokens']>
  ) {
    const current = painted.get(this)
    if (current) painted.set(this, { ...current, tokens: tokenList(args[0]) })
    return setTokens.apply(this, args)
  })
  onTestFinished(() => {
    textSpy.mockRestore()
    tokensSpy.mockRestore()
  })
}

function tokenList(tokens: EditorTokenInput) {
  return toEditorTokenStore(tokens).toTokens()
}

/** A parsed token that does not cover exactly the first word of the row it lands on. */
function misplacedTokens(pane: Painted) {
  return parsedTokens(pane).flatMap((token) => {
    const lineStart = pane.text.lastIndexOf('\n', token.start - 1) + 1
    const lineEnd = pane.text.indexOf('\n', token.start)
    const row = pane.text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    const word = /^\s*([A-Za-z]+)/.exec(row)
    const covered = pane.text.slice(token.start, token.end)
    if (word && covered === word[1] && token.start === lineStart + row.indexOf(word[1]!)) return []

    return [{ covered, row }]
  })
}

/** The pane also paints its own row tokens; only the stub parser's colour came from a parse. */
function parsedTokens(pane: Painted) {
  return pane.tokens.filter((token) => token.style.color === PARSED_COLOR)
}

/** Colours the first word of every source line, so a token carries its line's shape. */
function firstWordTokens(text: string) {
  const tokens: EditorToken[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const word = /^\s*([A-Za-z]+)/.exec(line)
    if (word) {
      const start = offset + line.indexOf(word[1]!)
      tokens.push({ end: start + word[1]!.length, start, style: { color: PARSED_COLOR } })
    }
    offset += line.length + 1
  }

  return tokens
}

function firstWordSession(options: EditorSyntaxSessionOptions, tokens: readonly EditorToken[]) {
  const result = {
    ...createEmptySyntaxResult({
      language: {
        includeCaptures: true,
        includeHighlights: true,
        languageId: options.languageId,
        mode: 'full',
      },
      requestedRanges: [{ endIndex: options.snapshot.length, startIndex: 0 }],
      snapshot: { documentId: options.documentId, length: options.snapshot.length, version: 1 },
    }),
    tokens,
  }

  return {
    applyChange: async () => result,
    dispose: () => undefined,
    foldingSupport: 'supported' as const,
    getResult: () => result,
    getSnapshotVersion: () => 0,
    getTokens: () => tokens,
    refresh: async () => result,
  }
}

function checkpointComparison(kind: Kind, file: string): GitComparison {
  const source = {
    owner: filesystemPath('repo'),
    sessionId: TEST_SESSION_ID,
    fromTurnCount: 0,
    toTurnCount: 1,
  }
  if (kind === 'checkpoint-file') {
    return { ...source, kind, file: fileResource(filesystemPath(file)) }
  }

  return { ...source, kind }
}

/** Neighbouring lines start with words of different lengths, so a token one line off is visible. */
function lines(name: string) {
  return Array.from({ length: 40 }, (_, index) => sourceLine(name, index + 1))
}

function sourceLine(name: string, line: number) {
  const shapes = [
    `export const ${name}${line} = ${line}`,
    `let ${name}${line} = 'x'`,
    `function ${name}${line}() {}`,
    `const ${name}${line} = true`,
  ]
  return shapes[line % shapes.length]!
}

function editedLine(line: number) {
  return `let edited${line} = 'y'`
}

/** Edits lines 5 and 30, so each hunk starts after line 1 and the lines between are omitted. */
function editedLines(name: string) {
  return lines(name).map((text, index) => {
    if (index + 1 === 5 || index + 1 === 30) return editedLine(index + 1)
    return text
  })
}

/** Checkpoint entries for both files, then an unrelated working copy the view must never read. */
async function editBoth(repo: string, client: Client) {
  const diffs: GitFileDiff[] = []
  for (const name of ['first', 'second']) {
    await writeFile(path.join(repo, `${name}.ts`), `${editedLines(name).join('\n')}\n`)
    const [diff] = await fetchDiff(`repo/${name}.ts`, false, undefined, client)
    diffs.push(diff!)
    await writeFile(path.join(repo, `${name}.ts`), 'unrelated working copy\n')
  }

  return diffs
}

/** A staged add of `added.ts`, or a staged delete of `deleted.ts`, as a checkpoint entry. */
async function stagedEntry(repo: string, client: Client, change: 'added' | 'deleted') {
  const file = `${change}.ts`
  await writeFile(path.join(repo, file), `${lines(change).join('\n')}\n`)
  git(repo, 'add', file)
  if (change === 'deleted') {
    git(repo, 'commit', '-m', 'add deleted.ts')
    git(repo, 'rm', '--cached', '--quiet', file)
  }
  const [entry] = await fetchDiff(`repo/${file}`, true, undefined, client)

  return entry!
}

async function useSplitView(client: Client) {
  await saveSettings(
    {
      mutationId: 'diff-syntax-split',
      operations: [{ key: 'editor.diff.viewMode', kind: 'set', value: 'split' }],
      target: 'user',
    },
    client,
  )
}

async function initRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  for (const name of ['first', 'second']) {
    await writeFile(path.join(repo, `${name}.ts`), `${lines(name).join('\n')}\n`)
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'init')

  return repo
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}
