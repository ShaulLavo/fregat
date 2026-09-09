import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { MAX_APPLIED_TABS } from '@workspace/client-core/address/grammar'
import { readSettingsCategory } from '@/features/settings/state/category-store'
import { settingsDocumentId } from '@/features/settings/utils/document'

import { expect, test } from '../../../../test/fixtures'
import {
  editorTabPaths,
  flushProjection,
  pressBack,
  recordHistoryWrites,
  renderAddressHarness,
  seedWorkspaceCache,
  startAt,
} from '../../../../test/address'

/**
 * The two edges, mounted. Everything here is about what happens BETWEEN the codec and
 * the stores — which the pure tests in this folder cannot see.
 */

const ROOT = '/repo'

/**
 * The fixtures below spell `?tabs=` with BARE slashes, the way `serializeSearch` emits
 * it. Percent-encoding them (`f%2Fa.ts`) makes `pathForDocumentToken` reject each token
 * as an unknown kind, so the union never runs and any "tabs unchanged" assertion passes
 * against a decoder rejection rather than against the behaviour it names.
 */
test('a foreign link does not close the tabs the cache restored', async () => {
  // Six tabs remembered locally; a shared link naming two of them.
  const remembered = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map(
    (name) => `${ROOT}/${name}`,
  )
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: remembered })
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?tabs=f/a.ts~f/b.ts`)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  // Someone else's link is not an instruction to delete your workspace. The encoder
  // already refuses to emit a truncated tab set for exactly this reason.
  expect(editorTabPaths(harness.workspace)).toEqual(remembered)
})

/**
 * The other half, and the one the assertion above cannot make: a token the cache does
 * NOT already hold has to arrive. Without it, "union" and "ignore the address entirely"
 * are indistinguishable.
 */
test('a link opens the tabs it names alongside the remembered ones', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?tabs=f/a.ts~f/new.ts`)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  expect(editorTabPaths(harness.workspace)).toEqual([`${ROOT}/a.ts`, `${ROOT}/new.ts`])
})

/**
 * The cap belongs to both consumers. The boot merge runs inside `EditorStateProvider`'s
 * `useState` initializer, so an unbounded `?tabs=` blocks first paint on a quadratic
 * open loop — and the result is real store state the cache persistence then writes out.
 */
test('a link naming more tabs than a person could open is rejected whole', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const tokens = Array.from({ length: MAX_APPLIED_TABS + 1 }, (_, index) => `f/many-${index}.ts`)
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?tabs=${tokens.join('~')}`)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  expect(editorTabPaths(harness.workspace)).toEqual([`${ROOT}/a.ts`])
})

test('going back does not answer with a push', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`, `${ROOT}/b.ts`] })
  const first = `/~${testWorkspaceToken('/repo')}/workbench/f/a.ts`
  startAt(first)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  const history_ = recordHistoryWrites()
  try {
    // Navigate: selecting the other tab is an identity change, so the projection pushes.
    const panels = harness.workspace.getState().workbenchPanels
    harness.workspace
      .getState()
      .setWorkbenchPanels({ ...panels, activeEditorTabId: panels.editorTabs[1].id })
    await flushProjection()
    expect(history_.pushes).toHaveLength(1)

    // Now go back. The applier honours it — and the projection must answer with a
    // replace, not a push: `pushState` truncates the forward entry the user is
    // standing next to, so a push here destroys the forward button outright.
    await pressBack(first)

    expect(history_.pushes).toHaveLength(1)
  } finally {
    history_.restore()
  }
})

test('walking back out of settings closes it and clears the category', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const withoutSettings = `/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?tabs=f/a.ts`
  startAt(withoutSettings)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  await pressBack(
    `/~${testWorkspaceToken('/repo')}/workbench/settings?tabs=f/a.ts~settings&settings=Providers`,
  )
  expect(readSettingsCategory()).toBe('Providers')
  expect(editorTabPaths(harness.workspace)).toContain(settingsDocumentId())

  await pressBack(withoutSettings)

  expect(editorTabPaths(harness.workspace)).not.toContain(settingsDocumentId())
  expect(readSettingsCategory()).toBeNull()
})

test('a category parameter alone does not open settings', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?settings=Providers`)

  const { harness } = await renderAddressHarness()
  await flushProjection()

  expect(editorTabPaths(harness.workspace)).toEqual([`${ROOT}/a.ts`])
})

test('restoring settings in the background keeps the selected file', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  startAt(
    `/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?tabs=f/a.ts~settings&settings=Providers`,
  )

  const { harness } = await renderAddressHarness()
  await flushProjection()

  const panels = harness.workspace.getState().workbenchPanels
  expect(editorTabPaths(harness.workspace)).toContain(settingsDocumentId())
  expect(panels.editorTabs.find((tab) => tab.id === panels.activeEditorTabId)?.path).toBe(
    `${ROOT}/a.ts`,
  )
})

test('folderless settings opens through its document token', async () => {
  startAt('/~-/workbench/settings?tabs=settings&settings=Providers')

  const { harness } = await renderAddressHarness()
  await flushProjection()

  expect(editorTabPaths(harness.workspace)).toEqual([settingsDocumentId()])
  expect(readSettingsCategory()).toBe('Providers')
  expect(location.pathname).toBe('/~-/workbench/settings')
})

/**
 * A short link EXPANDS on arrival, and that is correct: the URL renders the whole
 * store, and after opening someone's link you really are at that file with your own
 * tabs open. What must hold is that expanding never drops what the link named, and
 * that it settles after one pass instead of rewriting forever.
 */
test('honouring a short link keeps every slot it named, then settles', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts?side=git`)

  await renderAddressHarness()
  await flushProjection()
  const settled = `${location.pathname}${location.search}`

  expect(settled).toContain(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts`)
  expect(settled).toContain('side=git')

  await flushProjection()
  expect(`${location.pathname}${location.search}`).toBe(settled)
})

/**
 * The strong version, for the only URLs the projection ever wrote itself. A popped
 * entry is by definition projection output, so re-rendering the store it restores must
 * reproduce it byte for byte — costing no history write at all.
 */
test('returning to an address this app wrote costs no write', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`, `${ROOT}/b.ts`] })
  startAt(`/~${testWorkspaceToken('/repo')}/workbench/f/a.ts`)

  const { harness } = await renderAddressHarness()
  await flushProjection()
  const first = `${location.pathname}${location.search}`

  const panels = harness.workspace.getState().workbenchPanels
  harness.workspace
    .getState()
    .setWorkbenchPanels({ ...panels, activeEditorTabId: panels.editorTabs[1].id })
  await flushProjection()

  const history_ = recordHistoryWrites()
  try {
    await pressBack(first)

    expect(history_.pushes).toEqual([])
    expect(history_.replaces).toEqual([])
    expect(`${location.pathname}${location.search}`).toBe(first)
  } finally {
    history_.restore()
  }
})
