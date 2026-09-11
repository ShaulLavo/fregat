import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { test, expect } from '../../../../test/fixtures'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { createObservedInProcessClient } from '../../../../test/client'
import { applyAddressView } from '@/features/address/state/apply-view'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'
import { makeSessionDomainFixture, DOMAIN_SESSION } from '../../../../test/factories/session-domain'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { scopedSessionKey } from '@workspace/contracts'

test('boot adds tabs while explicit navigation orders addressed tabs and retains dirty and outside-root extras', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'repo'))
  const workspace = await registerTestWorkspaceAddress(client, 'repo')
  const { application, editor, commands } = await createAddressTestRuntime(client)
  const href = `/~${workspaceToken(workspace)}/workbench`
  const apply = (suffix: string, reason: 'boot' | 'navigate') =>
    applyAddressView({
      application,
      address: parseAddressIntent(href + suffix),
      reason,
      isCurrent: () => true,
    })
  expect((await apply('/f/a.ts?tabs=@~f/b.ts~f/c.ts', 'boot')).status).toBe('applied')
  commands.openFileSurface('repo/dirty.ts')
  const dirtyTab = editor.workspaceStore.getState().workbenchPanels.editorTabs.at(-1)
  if (!dirtyTab) return expect.unreachable('dirty tab was not opened')
  editor.documentStore.getState().ensureEditorView(dirtyTab.id, {
    content: 'unsaved',
    path: dirtyTab.path,
    size: 7,
    version: 'test',
    mtimeMs: 1,
  })
  editor.documentStore.getState().setLiveEditorDocumentDirty(dirtyTab.path, true)
  commands.openFileSurface('outside.ts')
  await apply('/f/b.ts?tabs=f/c.ts~@~f/a.ts', 'boot')
  expect(editor.workspaceStore.getState().openFilePaths).toEqual([
    'repo/a.ts',
    'repo/b.ts',
    'repo/c.ts',
    'repo/dirty.ts',
    'outside.ts',
  ])
  await apply('/f/b.ts?tabs=f/c.ts~@~f/a.ts', 'navigate')
  expect(editor.workspaceStore.getState().openFilePaths).toEqual([
    'repo/c.ts',
    'repo/b.ts',
    'repo/a.ts',
    'repo/dirty.ts',
    'outside.ts',
  ])
  await apply('?tabs=-', 'navigate')
  expect(editor.workspaceStore.getState().openFilePaths).toEqual(['repo/dirty.ts', 'outside.ts'])
  expect(editor.workspaceStore.getState().selectedFilePath).toBeNull()
  expect(editor.documentStore.getState().dirtyFilePaths.has('repo/dirty.ts')).toBe(true)
})

test('traversal preserves utility panels and filters while restoring document focus', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'repo'))
  const workspace = await registerTestWorkspaceAddress(client, 'repo')
  const { application, editor } = await createAddressTestRuntime(client)
  const href = `/~${workspaceToken(workspace)}/workbench/f/a.ts`
  expect(
    await applyAddressView({
      application,
      address: parseAddressIntent(
        href +
          '?side=git&bottom=problems&tool=logs&rail=archived&s.q=hello&s.m=regex&s.case=1&s.in=src#L4',
      ),
      reason: 'boot',
      isCurrent: () => true,
    }),
  ).toEqual({ status: 'applied', reason: 'boot' })
  await applyAddressView({
    application,
    address: parseAddressIntent(href + '?s.case=0&s.m=literal'),
    reason: 'boot',
    isCurrent: () => true,
  })
  expect(editor.searchBufferStore.getState().active).toMatchObject({
    query: 'hello',
    caseSensitive: false,
    matchMode: 'literal',
    includeGlobText: 'src',
  })
  await applyAddressView({
    application,
    address: parseAddressIntent(href),
    reason: 'traverse',
    isCurrent: () => true,
  })
  expect(editor.workspaceStore.getState().workbenchPanels).toMatchObject({
    activeSidebarTab: 'git',
    activeBottomTab: 'problems',
  })
  expect(editor.workspaceStore.getState().chatModePanels.activeToolTab).toBe('logs')
  expect(useSessionRailStore.getState().view).toBe('archived')
  expect(useSidebarSelectionStore.getState().selection).toEqual({ kind: 'auto' })
  expect(editor.searchBufferStore.getState().active).toMatchObject({
    query: 'hello',
    matchMode: 'literal',
    includeGlobText: 'src',
    filtersVisible: true,
  })
  expect(editor.uiStore.getState().definitionTarget).toBeNull()
  const state = editor.workspaceStore.getState()
  state.setWorkbenchPanels({ ...state.workbenchPanels, sidebarOpen: false, bottomPanelOpen: false })
  state.setChatModePanels({ ...state.chatModePanels, toolPaneOpen: false })
  await applyAddressView({
    application,
    address: parseAddressIntent(href + '?s.q=next'),
    reason: 'navigate',
    isCurrent: () => true,
  })
  expect(editor.workspaceStore.getState().workbenchPanels).toMatchObject({
    sidebarOpen: false,
    bottomPanelOpen: false,
  })
  expect(editor.workspaceStore.getState().chatModePanels.toolPaneOpen).toBe(false)
})

test('sidebar sessions retain the editor worktree while main sessions select their own checkout and reject other projects', async () => {
  const fixture = await makeSessionDomainFixture()
  const { application, editor, environmentId } = await createAddressTestRuntime(fixture.client)
  try {
    await fixture.register('register-main', 'main')
    const linked = await fixture.register('register-linked', 'linked')
    if (!linked.result) return expect.unreachable('linked worktree was not registered')
    await fixture.createSession(linked.result.worktreeId)
    const workspace = await registerTestWorkspaceAddress(fixture.client, 'main')
    const href = `/~${workspaceToken(workspace)}`
    const apply = (suffix: string) =>
      applyAddressView({
        application,
        address: parseAddressIntent(href + suffix),
        reason: 'traverse',
        isCurrent: () => true,
      })
    expect(
      (await apply(`/workbench/f/keep.txt?tabs=@&side=chat&chat=t/${DOMAIN_SESSION}`)).status,
    ).toBe('applied')
    expect(editor.workspaceStore.getState().rootFolder?.path).toBe('main')
    expect(useSidebarSelectionStore.getState().selection).toMatchObject({
      environmentId,
      sessionId: DOMAIN_SESSION,
    })
    expect((await apply(`/chat/t/${DOMAIN_SESSION}?diff=opaque-turn`)).status).toBe('applied')
    expect(editor.workspaceStore.getState().rootFolder?.path).toBe('linked')
    expect(useSessionSelectionStore.getState().selection).toMatchObject({
      environmentId,
      sessionId: DOMAIN_SESSION,
    })
    await apply(`/chat/t/${DOMAIN_SESSION}`)
    expect(
      useSessionDiffScopeStore.getState().scopeBySessionKey[
        scopedSessionKey({ environmentId, sessionId: DOMAIN_SESSION })
      ]?.scope,
    ).toEqual({ kind: 'working-tree' })
    await mkdir(path.join(fixture.server.root, 'other'))
    await fixture.register('register-other', 'other')
    const other = await registerTestWorkspaceAddress(fixture.client, 'other')
    const rejected = await applyAddressView({
      application,
      address: parseAddressIntent(`/~${workspaceToken(other)}/chat/t/${DOMAIN_SESSION}`),
      reason: 'navigate',
      isCurrent: () => true,
    })
    expect(rejected.status).toBe('unavailable')
    expect(editor.workspaceStore.getState().rootFolder?.path).toBe('linked')
  } finally {
    application.dispose()
    await fixture.server.cleanup()
  }
})

test('superseding a root lookup prevents it from opening its workspace', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'repo'))
  const workspace = await registerTestWorkspaceAddress(client, 'repo')
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const gated = createObservedInProcessClient(server, async (request) => {
    if (!new URL(request.url).pathname.startsWith('/fs/workspace-address/')) return
    started.resolve()
    await release.promise
  })
  const { application, editor } = await createAddressTestRuntime(gated)
  let current = true
  const pending = applyAddressView({
    application,
    address: parseAddressIntent(`/~${workspaceToken(workspace)}/workbench/f/a.ts`),
    reason: 'navigate',
    isCurrent: () => current,
  })
  await started.promise
  current = false
  release.resolve()
  expect((await pending).status).toBe('superseded')
  expect(editor.workspaceStore.getState().rootFolder).toBeNull()
  expect(editor.workspaceStore.getState().openFilePaths).toEqual([])
})
