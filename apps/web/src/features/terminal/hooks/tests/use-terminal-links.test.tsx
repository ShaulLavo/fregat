import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { act, waitFor } from '@testing-library/react'
import type { Terminal, LinkLineSnapshot, LinkProvider } from 'ghostty-webgpu'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useEffect, useEffectEvent } from 'react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { useEditorUiState } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useTerminalLinks } from '@/features/terminal/hooks/use-links'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import {
  activeServerOrigin,
  getClient,
  setActiveServerOrigin,
  setClient,
  type Client,
} from '@/lib/client'
import { createInProcessClient, createObservedInProcessClient } from '../../../../../test/client'
import { createRequestGate } from '../../../../../test/factories/request-gate'
import { installTestClient } from '../../../../../test/factories/client-binding'
import { makeTestServer } from '../../../../../test/server'
import type { TestServer } from '../../../../../test/server'
import { navigationWorkspace } from '../../../../../test/factories/navigation-workspace'
import { seedWorkspaceCache } from '../../../../../test/address'
import { createTestApplicationRuntime } from '../../../../../test/factories/application-runtime'

const COLUMNS = 24
/**
 * A project folder inside the server's workspace. Every path reaches the fs
 * routes relative to that workspace root — never absolute — so the panel's
 * `rootPath` carries the same relative form the real app passes it.
 */
const PROJECT_ROOT = 'repo'

test('the provider is registered with the terminal and asked for every row', async ({
  client,
  server,
}) => {
  const terminal = fakeTerminal(['  at src/a.ts:3', 'nothing to click here'])
  await renderTerminalLinks(client, server, terminal)

  // Registration is the whole contract with ghostty: skip it and the feature is
  // gone while every pure detection test still passes.
  await waitFor(() => expect(terminal.providers).toHaveLength(1))
  const links = await provideLinks(terminal, 0)

  expect(links?.map((link) => link.text)).toEqual(['src/a.ts:3'])
  // A row with no path answers `undefined`, not an empty array: ghostty caches
  // the answer per row and an array claims those cells for this provider.
  expect(await provideLinks(terminal, 1)).toBeUndefined()
})

test('a link range is 0-based and inclusive at both ends', async ({ client, server }) => {
  const row = '  at src/a.ts:3'
  const terminal = fakeTerminal([row])
  await renderTerminalLinks(client, server, terminal)

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
  const terminal = fakeTerminal(['  at src/a.ts:3'])
  const opened = openedPaths()
  const { getByTestId } = await renderTerminalLinks(client, server, terminal, opened)
  await writeWorkspaceFile(server.root, 'src/a.ts')
  // Requesting the client fixture is what points the app's RPC singleton at
  // this server, and it doubles as the precondition: the file is really there.
  expect((await client.fs.stat.get({ query: { path: 'repo/src/a.ts' } })).data?.type).toBe('file')
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
  const terminal = fakeTerminal(['  at src/gone.ts:3', '  at src/a.ts:3'])
  const opened = openedPaths()
  const { getByTestId } = await renderTerminalLinks(client, server, terminal, opened)
  // What `cd apps/web && bun test` produces: output relative to a cwd this side
  // cannot see, resolved against the panel root into a file that is not there.
  // Opening a tab on it would read as the file having come up empty.
  await writeWorkspaceFile(server.root, 'src/a.ts')
  // Ground truth from the same server the click will ask: one path is a real
  // file, the other was never written.
  expect((await client.fs.stat.get({ query: { path: 'repo/src/gone.ts' } })).data).toBeNull()
  await waitFor(() => expect(terminal.providers).toHaveLength(1))

  await activateLink(terminal, 0, clickEvent())
  await activateLink(terminal, 1, clickEvent())

  await waitFor(() => expect(getByTestId('selected-path')).toHaveTextContent('repo/src/a.ts'))
  expect(opened.paths).toEqual(['repo/src/a.ts'])
})

test('a retained terminal validates and opens on its owner after another server is selected', async ({
  server,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const gate = createRequestGate((request) => new URL(request.url).pathname === '/fs/stat')
  const client = createObservedInProcessClient(server, gate.beforeRequest)
  const restore = installTestClient(client)
  const terminal = fakeTerminal(['  at src/a.ts:3'])
  const opened = openedPaths()
  const view = await renderTerminalLinks(client, server, terminal, opened)
  await writeWorkspaceFile(server.root, 'src/a.ts')
  await waitFor(() => expect(terminal.providers).toHaveLength(1))
  const origin = activeServerOrigin()
  setActiveServerOrigin('http://localhost:3499')
  const previousB = getClient()
  const clientB = createInProcessClient(secondServer)
  setClient(clientB)

  try {
    const opening = activateLink(terminal, 0, clickEvent())
    await gate.entered
    gate.release()
    await opening
    await waitFor(() =>
      expect(view.getByTestId('selected-path')).toHaveTextContent('repo/src/a.ts'),
    )
    expect(opened.paths).toEqual(['repo/src/a.ts'])
    expect((await clientB.fs.stat.get({ query: { path: 'repo/src/a.ts' } })).data).toBeNull()
  } finally {
    gate.release()
    view.unmount()
    view.queryClient.clear()
    setClient(previousB)
    setActiveServerOrigin(origin)
    restore()
    await secondServer.cleanup()
  }
})

test('a slow link validation cannot replace the navigation from a newer click', async ({
  server,
}) => {
  const gate = createRequestGate((request) => {
    const url = new URL(request.url)
    return url.pathname === '/fs/stat' && url.searchParams.get('path') === 'repo/src/a.ts'
  })
  const client = createObservedInProcessClient(server, gate.beforeRequest)
  const restore = installTestClient(client)
  const terminal = fakeTerminal(['  at src/a.ts:3', '  at src/b.ts:3'])
  const opened = openedPaths()
  const view = await renderTerminalLinks(client, server, terminal, opened)
  await writeWorkspaceFile(server.root, 'src/a.ts')
  await writeWorkspaceFile(server.root, 'src/b.ts')

  try {
    await waitFor(() => expect(terminal.providers).toHaveLength(1))
    const first = activateLink(terminal, 0, clickEvent())
    await gate.entered
    await activateLink(terminal, 1, clickEvent())
    await waitFor(() =>
      expect(view.getByTestId('selected-path')).toHaveTextContent('repo/src/b.ts'),
    )
    await act(async () => {
      gate.release()
      await first
    })
    expect(opened.paths).toEqual(['repo/src/b.ts'])
    expect(view.getByTestId('selected-path')).toHaveTextContent('repo/src/b.ts')
  } finally {
    gate.release()
    view.unmount()
    view.queryClient.clear()
    restore()
  }
})

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string) {
  const target = path.join(workspaceRoot, PROJECT_ROOT, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'export const value = 1\n')
}

async function activateLink(terminal: FakeTerminal, row: number, event: MouseEvent) {
  const link = (await provideLinks(terminal, row))?.[0]
  return link?.activate(event)
}

function openedPaths(): OpenedPaths {
  return { paths: [] }
}

async function renderTerminalLinks(
  client: Client,
  server: TestServer,
  terminal: FakeTerminal,
  opened: OpenedPaths = openedPaths(),
) {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const application = createTestApplicationRuntime()
  return renderWithProviders(
    <EditorStateProvider>
      <>
        <TerminalLinkHost rootPath={PROJECT_ROOT} terminal={terminal.terminal} />
        <EditorSelectionProbe opened={opened} />
      </>
    </EditorStateProvider>,
    { application },
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
