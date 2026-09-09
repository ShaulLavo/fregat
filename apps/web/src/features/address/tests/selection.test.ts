import {
  testWorkspaceAddress,
  testWorkspaceToken,
} from '../../../../test/factories/workspace-address'
import { formatAddress, parseAddress } from '@workspace/client-core/address/grammar'
import { addressedWorkspaceCache, panelsForAddress } from '@/features/address/utils/cache'
import { addressFromSnapshot, emptyAddressSnapshot } from '@/features/address/utils/snapshot'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import {
  activeEditorPathForWorkbenchPanels,
  createDefaultWorkbenchPanels,
  openEditorPathInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { emptyWorkspaceSlice, emptyWorkspaceState } from '@/features/workspace/state/cache'

import { expect, test } from '../../../../test/fixtures'

const ROOT = '/repo'
const SESSION = 't/99dc0669-0262-4f92-a8d2-85ff6baea075'
const PATHS = [`${ROOT}/a.ts`, settingsDocumentId(), searchBufferDocumentId(ROOT)]
function cachedWorkspace() {
  const panels = PATHS.reduce(openEditorPathInWorkbenchPanels, createDefaultWorkbenchPanels())
  return {
    ...emptyWorkspaceState(),
    rootFolder: {
      birthtimeMs: 0,
      mtimeMs: 0,
      name: 'repo',
      path: ROOT,
      size: 0,
      type: 'directory' as const,
      version: '',
      workspaceAddress: testWorkspaceAddress(ROOT),
    },
    workspaceOrder: [ROOT],
    workspaces: { [ROOT]: { ...emptyWorkspaceSlice(), workbenchPanels: panels } },
  }
}

test.each(PATHS)('chat restores %s before any effects regardless of the last tab', (path) => {
  const address = addressFromSnapshot({
    ...emptyAddressSnapshot(),
    rootPath: ROOT,
    workspaceAddress: testWorkspaceAddress(ROOT),
    mode: 'chat',
    sessionToken: SESSION,
    activeDocumentPath: path,
    editorTabPaths: PATHS,
  })
  const parsed = parseAddress(formatAddress(address))
  const restored = addressedWorkspaceCache(cachedWorkspace(), parsed).workspaces[ROOT]
    .workbenchPanels

  expect(parsed.document).toBe(SESSION)
  expect(parsed.tabs).toEqual(['f/a.ts', 'settings', 's'])
  expect(activeEditorPathForWorkbenchPanels(restored)).toBe(path)
  expect(restored.editorTabs.map((tab) => tab.path)).toEqual(PATHS)
})

test.each(PATHS)('workbench restores %s through the same document pipeline', (path) => {
  const address = addressFromSnapshot({
    ...emptyAddressSnapshot(),
    rootPath: ROOT,
    workspaceAddress: testWorkspaceAddress(ROOT),
    mode: 'workbench',
    activeDocumentPath: path,
    editorTabPaths: PATHS,
  })
  const restored = addressedWorkspaceCache(cachedWorkspace(), parseAddress(formatAddress(address)))

  expect(address.editor).toBeNull()
  expect(activeEditorPathForWorkbenchPanels(restored.workspaces[ROOT].workbenchPanels)).toBe(path)
})

test('a tab collection without a selection preserves the cached active tab', () => {
  const address = parseAddress(
    `/~${testWorkspaceToken('/repo')}/chat/${SESSION}?tabs=s~settings~f/a.ts~f/new.ts`,
  )
  const restored = addressedWorkspaceCache(cachedWorkspace(), address).workspaces[ROOT]
    .workbenchPanels

  expect(restored.editorTabs.map((tab) => tab.path)).toContain(`${ROOT}/new.ts`)
  expect(activeEditorPathForWorkbenchPanels(restored)).toBe(searchBufferDocumentId(ROOT))
})

test('a settings category does not select a background settings tab', () => {
  const address = parseAddress(
    `/~${testWorkspaceToken('/repo')}/chat/${SESSION}?tabs=f/a.ts~settings~s&editor=f/a.ts&settings=providers`,
  )
  const restored = addressedWorkspaceCache(cachedWorkspace(), address).workspaces[ROOT]
    .workbenchPanels

  expect(activeEditorPathForWorkbenchPanels(restored)).toBe(`${ROOT}/a.ts`)
})

test('boot restores the addressed file by cached ID even when its readable name changed', () => {
  const address = parseAddress(
    `/~${testWorkspaceToken(ROOT, 'old.checkout.name')}/workbench/f/new.ts`,
  )
  const restored = addressedWorkspaceCache(cachedWorkspace(), address)

  expect(activeEditorPathForWorkbenchPanels(restored.workspaces[ROOT].workbenchPanels)).toBe(
    `${ROOT}/new.ts`,
  )
})

test('boot never applies another checkout ID to a cached root with the same basename', () => {
  const cached = cachedWorkspace()
  const address = parseAddress(`/~${testWorkspaceToken('/forks/repo')}/workbench/f/new.ts`)

  expect(addressedWorkspaceCache(cached, address)).toBe(cached)
})

test('folderless settings retains its document, tab and category in the address', () => {
  const address = addressFromSnapshot({
    ...emptyAddressSnapshot(),
    mode: 'workbench',
    activeDocumentPath: settingsDocumentId(),
    editorTabPaths: [settingsDocumentId()],
    settingsCategory: 'providers',
  })

  expect(parseAddress(formatAddress(address))).toMatchObject({
    workspace: '-',
    mode: 'workbench',
    document: 'settings',
    tabs: ['settings'],
    settings: 'providers',
  })
})

test('folderless settings is selected by the synchronous boot panel merge', () => {
  const address = parseAddress('/~-/workbench/settings?tabs=settings&settings=providers')
  const panels = panelsForAddress(createDefaultWorkbenchPanels(), null, address)

  expect(panels.editorTabs.map((tab) => tab.path)).toEqual([settingsDocumentId()])
  expect(activeEditorPathForWorkbenchPanels(panels)).toBe(settingsDocumentId())
})

test.each(PATHS)('chat selection %s survives omission of an oversized tab collection', (path) => {
  const address = addressFromSnapshot({
    ...emptyAddressSnapshot(),
    rootPath: ROOT,
    workspaceAddress: testWorkspaceAddress(ROOT),
    mode: 'chat',
    sessionToken: SESSION,
    activeDocumentPath: path,
    editorTabPaths: [
      ...PATHS,
      ...Array.from({ length: 20 }, (_, index) => `${ROOT}/${'nested/'.repeat(15)}${index}.ts`),
    ],
  })
  const restored = addressedWorkspaceCache(cachedWorkspace(), parseAddress(formatAddress(address)))

  expect(address.tabs).toBeNull()
  expect(address.document).toBe(SESSION)
  expect(activeEditorPathForWorkbenchPanels(restored.workspaces[ROOT].workbenchPanels)).toBe(path)
})
