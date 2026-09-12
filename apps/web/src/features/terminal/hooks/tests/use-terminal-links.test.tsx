import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { waitFor } from '@testing-library/react'
import type { Terminal, LinkLineSnapshot, LinkProvider } from 'ghostty-webgpu'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useEffect, useEffectEvent, type ReactNode } from 'react'

import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { useEditorUiState } from '@/features/editor/state/ui-state'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
  useEditorWorkspaceState,
} from '@/features/editor/state/workspace-state'
import { useTerminalLinks } from '@/features/terminal/hooks/use-links'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const COLUMNS = 24
/**
 * A project folder inside the server's workspace. Every path reaches the fs
 * routes relative to that workspace root — never absolute — so the panel's
 * `rootPath` carries the same relative form the real app passes it.
 */
const PROJECT_ROOT = 'repo'

test('the provider is registered with the terminal and asked for every row', async () => {
  const terminal = fakeTerminal(['  at src/a.ts:3', 'nothing to click here'])
  renderTerminalLinks(terminal)

  // Registration is the whole contract with ghostty: skip it and the feature is
  // gone while every pure detection test still passes.
  await waitFor(() => expect(terminal.providers).toHaveLength(1))
  const links = await provideLinks(terminal, 0)

  expect(links?.map((link) => link.text)).toEqual(['src/a.ts:3'])
  // A row with no path answers `undefined`, not an empty array: ghostty caches
  // the answer per row and an array claims those cells for this provider.
  expect(await provideLinks(terminal, 1)).toBeUndefined()
})

test('a link range is 0-based and inclusive at both ends', async () => {
  const row = '  at src/a.ts:3'
  const terminal = fakeTerminal([row])
  renderTerminalLinks(terminal)

  await waitFor(() => expect(terminal.providers).toHaveLength(1))
  const link = (await provideLinks(terminal, 0))?.[0]

  expect(link?.range).toEqual({ end: 14, start: 5 })
  // The cells the range names must be exactly the link's own text — an
  // exclusive end or a 1-based column would paint the underline off by one.
  expect(row.slice(link?.range.start, (link?.range.end ?? 0) + 1)).toBe(link?.text)
})

test('an activated native link opens the file without a second modifier gate', async ({
  client,
  server,
}) => {
  await writeWorkspaceFile(server.root, 'src/a.ts')
  // Requesting the client fixture is what points the app's RPC singleton at
  // this server, and it doubles as the precondition: the file is really there.
  expect((await client.fs.stat.get({ query: { path: 'repo/src/a.ts' } })).data?.type).toBe('file')
  const terminal = fakeTerminal(['  at src/a.ts:3'])
  const opened = openedPaths()
  const { getByTestId } = renderTerminalLinks(terminal, opened)
  await waitFor(() => expect(terminal.providers).toHaveLength(1))

  await activateLink(terminal, 0, clickEvent())

  await waitFor(() => expect(getByTestId('selected-path')).toHaveTextContent('repo/src/a.ts'))
  expect(opened.paths).toEqual(['repo/src/a.ts'])
  expect(getByTestId('definition-target')).toHaveTextContent('@2')
  const selectedPath = opened.paths[0]
  if (!selectedPath) throw new TypeError('The terminal link did not select a file')
  expect((await client.fs.stat.get({ query: { path: selectedPath } })).data?.type).toBe('file')
})

test('a path that is not on disk reports instead of opening a phantom tab', async ({
  client,
  server,
}) => {
  // What `cd apps/web && bun test` produces: output relative to a cwd this side
  // cannot see, resolved against the panel root into a file that is not there.
  // Opening a tab on it would read as the file having come up empty.
  await writeWorkspaceFile(server.root, 'src/a.ts')
  // Ground truth from the same server the click will ask: one path is a real
  // file, the other was never written.
  expect((await client.fs.stat.get({ query: { path: 'repo/src/gone.ts' } })).data).toBeNull()
  const terminal = fakeTerminal(['  at src/gone.ts:3', '  at src/a.ts:3'])
  const opened = openedPaths()
  const { getByTestId } = renderTerminalLinks(terminal, opened)
  await waitFor(() => expect(terminal.providers).toHaveLength(1))

  await activateLink(terminal, 0, clickEvent())
  await activateLink(terminal, 1, clickEvent())

  await waitFor(() => expect(getByTestId('selected-path')).toHaveTextContent('repo/src/a.ts'))
  expect(opened.paths).toEqual(['repo/src/a.ts'])
})

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string) {
  const target = path.join(workspaceRoot, PROJECT_ROOT, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'export const value = 1\n')
}

async function activateLink(terminal: FakeTerminal, row: number, event: MouseEvent) {
  const link = (await provideLinks(terminal, row))?.[0]
  link?.activate(event)
}

function openedPaths(): OpenedPaths {
  return { paths: [] }
}

function renderTerminalLinks(terminal: FakeTerminal, opened: OpenedPaths = openedPaths()) {
  return renderWithProviders(
    withEditorWorkspace(
      <>
        <TerminalLinkHost rootPath={PROJECT_ROOT} terminal={terminal.terminal} />
        <EditorSelectionProbe opened={opened} />
      </>,
    ),
  )
}

function TerminalLinkHost({ rootPath, terminal }: { rootPath: string; terminal: Terminal }) {
  const registerTerminalLinks = useTerminalLinks(rootPath)
  // Mirrors the panel: ghostty hands the terminal over once, long after mount.
  const registerWhenReady = useEffectEvent(() => registerTerminalLinks(terminal))

  useEffect(() => {
    registerWhenReady()
  }, [terminal])

  return null
}

/**
 * Records every path the editor was told to open, not only the current one: a
 * click that opens the wrong file and is corrected a moment later leaves no
 * trace in the final state.
 */
function EditorSelectionProbe({ opened }: { opened: OpenedPaths }) {
  const selectedFilePath = useEditorWorkspaceState((state) =>
    state.selectedTabContent ? (tabFileResource(state.selectedTabContent)?.path ?? null) : null,
  )
  const definitionTarget = useEditorUiState((state) => state.definitionTarget)

  useEffect(() => {
    if (!selectedFilePath) return
    if (opened.paths.at(-1) === selectedFilePath) return

    opened.paths.push(selectedFilePath)
  }, [opened, selectedFilePath])

  return (
    <>
      <span data-testid='selected-path'>{selectedFilePath ?? 'none'}</span>
      <span data-testid='definition-target'>
        {definitionTarget
          ? `${definitionTarget.path}@${definitionTarget.range.start.line}`
          : 'none'}
      </span>
    </>
  )
}

function withEditorWorkspace(children: ReactNode) {
  return (
    <EditorStateProvider>
      <EditorWorkspaceStateContext.Provider value={createWorkspaceStore()}>
        {children}
      </EditorWorkspaceStateContext.Provider>
    </EditorStateProvider>
  )
}

function createWorkspaceStore() {
  return createEditorWorkspaceStore({
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: {
      birthtimeMs: 0,
      mtimeMs: 0,
      name: 'repo',
      path: filesystemPath(PROJECT_ROOT),
      size: 0,
      type: 'directory',
      version: '',
    },
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: [PROJECT_ROOT],
    workspaces: {},
  })
}

async function provideLinks(terminal: FakeTerminal, row: number) {
  const provider = terminal.providers[0]
  const content = terminal.rows[row]
  if (!provider || content === undefined) return undefined
  return provider.provideLinks(linkLine(content), row)
}

function clickEvent() {
  return new MouseEvent('click')
}

type OpenedPaths = {
  readonly paths: string[]
}

type FakeTerminal = {
  readonly providers: LinkProvider<Event>[]
  readonly rows: readonly string[]
  readonly terminal: Terminal
}

/**
 * ghostty is a WASM terminal painting a canvas, neither of which exists here.
 * The provider only touches `registerLinkProvider`, so the fake is exactly that
 * surface and the line snapshots come from the native provider boundary.
 */
function fakeTerminal(rows: readonly string[]): FakeTerminal {
  const providers: LinkProvider<Event>[] = []
  const terminal = {
    registerLinkProvider: (provider: LinkProvider<Event>) => {
      providers.push(provider)
      return { dispose: () => {}, token: Symbol('test-link-provider') }
    },
  }

  return { providers, rows, terminal: terminal as unknown as Terminal }
}

function linkLine(content: string): LinkLineSnapshot {
  const text = content.padEnd(COLUMNS, ' ')
  const cells = [...text].map((value) => ({ text: value }))
  const textStartByCell = cells.map((_cell, index) => index)
  const textEndByCell = cells.map((_cell, index) => index + 1)
  const startCellByTextBoundary = Array.from({ length: text.length + 1 }, (_value, index) =>
    index < cells.length ? index : undefined,
  )
  const endCellByTextBoundary = Array.from({ length: text.length + 1 }, (_value, index) =>
    index > 0 ? index - 1 : undefined,
  )
  return {
    cells,
    endCellByTextBoundary,
    startCellByTextBoundary,
    text,
    textEndByCell,
    textStartByCell,
  }
}
