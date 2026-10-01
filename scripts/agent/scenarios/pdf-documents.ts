import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Scenario } from './index'
import { committedFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { selectors, waitForApp } from '../selectors'
import type { Page } from 'playwright'
import { connectSecondOwner, type SecondOwner } from '../second-owner'
import { collectOrchestrationBases } from './chat-verification'
import { makePdf } from '../../../apps/web/test/factories/pdf'
import { isolatedNativeScenario } from './native-provider-verification'

export const pdfDocuments: Scenario = {
  name: 'pdf-documents',
  description:
    'Open an ASCII-only multi-page PDF through the file tree; select and search pages, prove lazy worker loading and no text read, then show a corrupt PDF error.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const { path: fixture } = await committedFixture('pdf-documents')
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    try {
      const binary = makePdf()
      // A valid ASCII-only PDF must select its viewer independently of binary-byte detection.
      const ascii = Uint8Array.from(binary, (byte) => (byte > 127 ? 32 : byte))
      await writeFile(join(fixture, 'pages.pdf'), ascii)
      await writeFile(join(fixture, 'corrupt.pdf'), 'This file is not a PDF.')
      await openFixtureWorkspace(page, fixture)
      ok(
        !requests.some((url) =>
          /pdfjs-dist\/build\/pdf|pdf\.worker|\/pdf-viewer\/engine\.ts/.test(url),
        ),
        'Normal workbench boot leaves PDF engine and worker unloaded',
      )
      await selectors.treeItem(page, 'pages.pdf').click()
      await selectors.pdfSearch(page).waitFor({ timeout: 30_000 })
      await selectors.pdfPage(page, 1).locator('.textLayer span').first().waitFor()
      strictEqual(await selectors.editorInput(page).count(), 0, 'PDF has no text editor')
      const textReads = requests.filter((url) => {
        const parsed = new URL(url)
        return (
          parsed.pathname.endsWith('/fs/read') &&
          parsed.searchParams.get('path')?.endsWith('/pages.pdf')
        )
      })
      strictEqual(textReads.length, 0, 'PDF bypasses decoded text snapshots')
      ok(
        requests.some((url) => url.includes('pdf.worker')),
        'PDF load starts its bundled worker',
      )
      const selected = await selectors
        .pdfPage(page, 1)
        .locator('.textLayer span')
        .first()
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = document.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
      ok(selected.includes('PDF verification'), 'PDF text is selectable')
      await step('pdf-selectable-editor')
      await searchSecondPage(page)
      await step('pdf-search-second-page')
      await writeFile(join(fixture, 'pages.pdf'), makePdf(['Updated PDF verification']))
      await selectors
        .pdfPage(page, 1)
        .locator('.textLayer span')
        .filter({ hasText: 'Updated' })
        .waitFor()
      await selectors.pdfSearch(page).fill('Updated')
      await selectors.pdfMatchCountValue(page, 1).waitFor()
      strictEqual(
        requests.filter((url) => {
          const parsed = new URL(url)
          return (
            parsed.pathname.endsWith('/fs/read') &&
            parsed.searchParams.get('path')?.endsWith('/pages.pdf')
          )
        }).length,
        0,
        'Watch-ready and changed frames never read PDF as decoded text',
      )
      await step('pdf-external-change-version-and-search')
      await selectors.treeItem(page, 'corrupt.pdf').click()
      await selectors.pdfFailure(page).waitFor({ timeout: 30_000 })
      await step('corrupt-pdf-readable-error')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

export const pdfAttachment = isolatedNativeScenario({
  name: 'pdf-attachment',
  description:
    'Upload a PDF through the real attachment transport, send through a fixture provider, and select/search the same viewer in the chat preview.',
  fixture: new URL('../fixtures/native-conversation.mjs', import.meta.url),
  async drive(page, { step }) {
    const bytes = makePdf()
    await selectors.chatMessage(page).fill('Read the attached verification file.')
    await selectors
      .chatComposerFileInput(page)
      .setInputFiles({ name: 'pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) })
    await selectors.chatStagedFile(page, 'pages.pdf').waitFor()
    await selectors.chatSend(page).click()
    await selectors.chatTranscriptFile(page, 'pages.pdf').waitFor({ timeout: 30_000 })
    await selectors.chatAssistantMarkdown(page).first().waitFor({ timeout: 30_000 })
    await selectors.chatTranscriptFile(page, 'pages.pdf').click()
    await selectors.pdfSearch(page).waitFor({ timeout: 30_000 })
    await selectors.pdfPage(page, 1).locator('.textLayer span').first().waitFor()
    await step('pdf-chat-preview')
    await searchSecondPage(page)
    await step('pdf-chat-search-second-page')
    await page.keyboard.press('Escape')
  },
})

export const pdfEngineUnavailable = unavailablePdfScenario(
  'pdf-engine-unavailable',
  '**/src/lib/pdf-viewer/engine.ts*',
)

export const pdfWorkerUnavailable = unavailablePdfScenario(
  'pdf-worker-unavailable',
  '**/*pdf.worker*',
)

function unavailablePdfScenario(name: string, route: string): Scenario {
  return {
    name,
    description:
      'Fail a lazy PDF runtime asset and show readable recovery guidance in the PDF pane.',
    requiresIsolatedServer: true,
    async run(page, { step }) {
      const { path: fixture } = await committedFixture(name)
      try {
        await writeFile(join(fixture, 'pages.pdf'), makePdf())
        await page.route(route, (request) => request.abort('failed'))
        await openFixtureWorkspace(page, fixture)
        await selectors.treeItem(page, 'pages.pdf').click()
        await selectors.pdfEngineFailure(page).waitFor({ timeout: 30_000 })
        await step(`${name}-readable-error`)
      } finally {
        await page.unroute(route)
        await releaseFixture(fixture)
      }
    },
  }
}

export const pdfRemoteOwner: Scenario = {
  name: 'pdf-remote-owner',
  description:
    'Open a PDF in a machine-qualified remote workspace and prove bytes come from that owner.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const { path: fixture } = await committedFixture('pdf-remote-owner')
    const bases = collectOrchestrationBases(page)
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    let remote: SecondOwner | null = null
    try {
      await writeFile(join(fixture, 'remote.pdf'), makePdf(['Remote owner PDF verification']))
      remote = await connectSecondOwner(page, bases)
      const current = new URL(page.url())
      const headers = { Origin: current.origin }
      const healthResponse = await page.request.get(`${remote.origin}/health`, { headers })
      ok(healthResponse.ok(), 'Remote identity is reachable')
      const health = await healthResponse.json()
      const workspaceResponse = await page.request.post(`${remote.origin}/fs/workspace-address`, {
        headers,
        data: { path: fixture.slice(1) },
      })
      ok(workspaceResponse.ok(), 'Remote workspace is registered with its owner')
      const workspace = await workspaceResponse.json()
      const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
      await page.goto(`${current.origin}/@${health.environmentId}/~${token}/workbench`)
      await waitForApp(page)
      await selectors.treeItem(page, 'remote.pdf').click()
      await selectors.pdfSearch(page).waitFor({ timeout: 30_000 })
      await selectors.pdfPage(page, 1).locator('.textLayer span').first().waitFor()
      const reads = requests
        .map((url) => new URL(url))
        .filter(
          (url) =>
            url.pathname.endsWith('/fs/blob') &&
            url.searchParams.get('path')?.endsWith('/remote.pdf'),
        )
      ok(reads.length > 0, 'Remote PDF has a blob read')
      ok(
        reads.every((url) => url.origin === remote!.origin),
        'Every PDF blob read uses the remote owner',
      )
      ok(
        reads.every((url) => url.searchParams.has('v')),
        'Every PDF blob read is version-qualified',
      )
      strictEqual(await selectors.editorInput(page).count(), 0, 'Remote PDF has no text editor')
      await selectors.pdfSearch(page).fill('Remote owner')
      await selectors.pdfMatchCountValue(page, 1).waitFor()
      await step('remote-owner-pdf-transport-and-search')
    } finally {
      await releaseFixture(fixture)
      await remote?.stop()
    }
  },
}

async function searchSecondPage(page: Page) {
  await selectors.pdfSearch(page).fill('PDF verification')
  await selectors.pdfMatchCount(page).waitFor()
  await selectors.pdfNext(page).click()
  await selectors.pdfNext(page).click()
  await selectors.pdfPage(page, 2).locator('.textLayer .highlight').first().waitFor()
  ok(
    await selectors.pdfScroller(page).evaluate((element) => element.scrollTop > 0),
    'Next scrolls the contained PDF viewport to the second page',
  )
}
