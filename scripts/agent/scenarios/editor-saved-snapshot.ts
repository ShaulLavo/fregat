import { strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const inspections = new WeakMap<Page, unknown>()

export const editorSavedSnapshot: Scenario = {
  name: 'editor-saved-snapshot',
  description:
    'Save into an immutable cache snapshot, then compare a later edit with the saved text.',
  inspect: async (page) => inspections.get(page),
  async run(page, { step }) {
    const fixture = await createGitFixture('editor-saved-snapshot')
    const diskPath = path.join(fixture, 'saved.txt')
    try {
      await writeFile(diskPath, 'original\n')
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'saved.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('saved ')
      await page.keyboard.press('Control+s')
      await waitForFileContent(diskPath, 'saved original\n')
      const cache = await page.evaluate(readSavedCache, diskPath.slice(1))
      inspections.set(page, cache)
      strictEqual(cache.snapshots.length, 1)
      strictEqual(cache.snapshots[0]?.retainedStringLength, 0)
      strictEqual(cache.snapshots[0]?.snapshotLength, 'saved original\n'.length)
      ok((cache.snapshots[0]?.observers ?? 0) > 0)
      ok(cache.saves.some((save) => save.status === 'success' && save.result === true))
      await step('saved-cache')
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('later ')
      await runPaletteCommand(page, 'Compare with saved')
      await selectors.diffRows(page).filter({ hasText: 'later saved original' }).waitFor()
      await selectors.diffRows(page).filter({ hasText: 'saved original' }).first().waitFor()
      inspections.set(page, {
        saved: cache,
        compared: await page.evaluate(readSavedCache, diskPath.slice(1)),
      })
      await step('saved-versus-later-edit')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function readSavedCache(target: string) {
  type CacheClient = {
    getQueryCache(): {
      getAll(): {
        queryKey: readonly unknown[]
        state: { data: unknown }
        getObserversCount(): number
      }[]
    }
    getMutationCache(): {
      getAll(): {
        options: { mutationKey?: readonly unknown[] }
        state: { status: string; variables: unknown; data: unknown }
      }[]
    }
  }
  const registry = globalThis as { __fregatQueryClients?: Map<string, CacheClient> }
  const clients = [...(registry.__fregatQueryClients?.values() ?? [])]
  const snapshots = clients.flatMap((client) =>
    client
      .getQueryCache()
      .getAll()
      .flatMap((query) => {
        if (query.queryKey[1] !== 'file-snapshots' || query.queryKey[2] !== target) return []
        const data = query.state.data
        if (!data || typeof data !== 'object') return []
        const source = 'textSnapshot' in data ? data.textSnapshot : null
        return [
          {
            key: query.queryKey,
            observers: query.getObserversCount(),
            retainedStringLength:
              'content' in data && typeof data.content === 'string' ? data.content.length : 0,
            snapshotLength:
              source && typeof source === 'object' && 'length' in source ? source.length : null,
          },
        ]
      }),
  )
  const saves = clients.flatMap((client) =>
    client
      .getMutationCache()
      .getAll()
      .filter((mutation) => mutation.options.mutationKey?.includes('save'))
      .map((mutation) => ({
        key: mutation.options.mutationKey,
        status: mutation.state.status,
        variables: mutation.state.variables,
        result: mutation.state.data,
      })),
  )
  return { snapshots, saves }
}
