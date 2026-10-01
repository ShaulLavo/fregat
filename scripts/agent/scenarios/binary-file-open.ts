import { strictEqual, ok } from 'node:assert/strict'
import { writeFile, rm, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openFileFromTree, selectors, waitForApp } from '../selectors'
import { collectOrchestrationBases } from './chat-verification'
import { connectSecondOwner, type SecondOwner } from '../second-owner'

export const binaryFileOpen: Scenario = {
  name: 'binary-file-open',
  description:
    'Open binary bytes with a text extension, reveal their file, open text normally and show a missing-file error.',
  async run(page, { step }) {
    const fixture = await createGitFixture('binary-file-open')
    try {
      await writeFile(join(fixture, 'binary.txt'), Buffer.from([0, 1, 2, 3, 255, 0, 7, 9]))
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '-m', 'fixture'])
      await writeFile(join(fixture, 'large.bin'), Buffer.from([0, 1, 255, 0, 7]))
      await truncate(join(fixture, 'large.bin'), 200 * 1024 * 1024 + 1)
      await writeFile(join(fixture, 'large-text.txt'), Buffer.from([0xff, 0xfe, 0x61, 0]))
      await truncate(join(fixture, 'large-text.txt'), 200 * 1024 * 1024 + 2)
      await openFixtureWorkspace(page, fixture)
      await selectors.treeItem(page, 'binary.txt').click()
      await step('binary-opened')
      await selectors.fileFacts(page).waitFor()
      strictEqual(await selectors.editorInput(page).count(), 0)
      ok((await selectors.fileFacts(page).textContent())?.includes('8 B'))
      await step('binary-facts-no-editor')
      await selectors.revealFileFacts(page).click()
      strictEqual(
        await selectors.treeItem(page, 'binary.txt').getAttribute('aria-selected'),
        'true',
      )
      await step('binary-revealed')
      await openFileFromTree(page, 'a.txt')
      await step('text-editor-unchanged')
      await selectors.treeItem(page, 'large.bin').click()
      await selectors.fileFacts(page).waitFor()
      strictEqual(await selectors.editorInput(page).count(), 0)
      ok((await selectors.fileFacts(page).textContent())?.includes('200 MB'))
      await step('oversized-binary-facts-no-editor')
      await selectors.treeItem(page, 'large-text.txt').click()
      await selectors.openReadOnly(page).waitFor()
      strictEqual(await selectors.fileFacts(page).count(), 0)
      await step('oversized-text-editing-limit')
      await page.route('**/fs/read?**', async (route) => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('path')?.endsWith('/missing.bin'))
          await rm(join(fixture, 'missing.bin'), { force: true })
        await route.continue()
      })
      // A fresh tree open retains recovery actions; restored missing tabs retire.
      await writeFile(join(fixture, 'missing.bin'), Buffer.from([0, 1, 2, 3]))
      await selectors.treeItem(page, 'missing.bin').click()
      await selectors.missingFileMessage(page).waitFor({ timeout: 15_000 })
      strictEqual(await selectors.fileFacts(page).count(), 0)
      await step('missing-binary-error')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const binaryFileRemote: Scenario = {
  name: 'binary-file-remote',
  description:
    'Read a binary file through its remote owner and reveal it within that owner’s workspace.',
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('binary-file-remote')
    const bases = collectOrchestrationBases(page)
    const home = page.url()
    let second: SecondOwner | null = null
    try {
      await writeFile(join(fixture, 'remote.bin'), Buffer.from([0, 1, 2, 255, 0]))
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '-m', 'fixture'])
      await writeFile(join(fixture, 'remote-large.bin'), Buffer.from([0, 1, 255, 0, 7]))
      await truncate(join(fixture, 'remote-large.bin'), 200 * 1024 * 1024 + 1)
      await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
      await selectors.sessionSearch(page).waitFor()
      second = await connectSecondOwner(page, bases)
      const headers = { Origin: new URL(page.url()).origin }
      const health = await (await page.request.get(`${second.origin}/health`, { headers })).json()
      const workspaceResponse = await page.request.post(`${second.origin}/fs/workspace-address`, {
        data: { path: fixture.slice(1) },
        headers,
      })
      ok(workspaceResponse.ok())
      const workspace = await workspaceResponse.json()
      const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
      const reads: string[] = []
      const sessions: { url: string; method: string }[] = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith('/fs/read-session'))
          sessions.push({ url: url.href, method: request.method() })
        if (url.pathname === '/fs/read' && url.searchParams.get('path')?.endsWith('/remote.bin'))
          reads.push(url.origin)
      })
      await page.goto(new URL(`/@${health.environmentId}/~${token}/workbench`, page.url()).href)
      await waitForApp(page)
      await selectors.treeItem(page, 'remote.bin').click()
      await selectors.fileFacts(page).waitFor()
      strictEqual(await selectors.editorInput(page).count(), 0)
      ok(reads.length > 0)
      ok(reads.every((origin) => origin === second!.origin))
      await step('remote-binary-facts')
      await selectors.treeItem(page, 'remote-large.bin').click()
      await selectors.fileFacts(page).waitFor()
      strictEqual(await selectors.editorInput(page).count(), 0)
      ok((await selectors.fileFacts(page).textContent())?.includes('200 MB'))
      ok(sessions.length >= 3)
      ok(sessions.every((request) => new URL(request.url).origin === second!.origin))
      ok(sessions.some((request) => request.method === 'DELETE'))
      for (const request of sessions.filter((request) => request.method === 'GET')) {
        strictEqual(new URL(request.url).searchParams.get('end'), '512')
      }
      await step('remote-oversized-binary-facts')
      await selectors.revealFileFacts(page).click()
      strictEqual(
        await selectors.treeItem(page, 'remote-large.bin').getAttribute('aria-selected'),
        'true',
      )
      ok(new URL(page.url()).pathname.startsWith(`/@${health.environmentId}/`))
      await evidence.json('remote-owner.json', {
        origin: second.origin,
        environmentId: health.environmentId,
        reads,
        sessions,
        revealUrl: page.url(),
      })
      await step('remote-binary-revealed')
    } finally {
      if (second) await page.goto(home)
      await second?.stop()
      await releaseFixture(fixture)
    }
  },
}
