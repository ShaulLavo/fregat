import { ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page, Request, Response } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { transientAlertSelector, selectors } from '../selectors'
import type { Scenario } from './index'
import { stageRelease } from './server-update'

const NAME = 'watcher-restart'
const RESTART_DELAY_MS = 8000
const FILESYSTEM_ALERT = /watching files|file watcher|filesystem|file system/i

type WatchRequest = {
  readonly at: number
  readonly document: number
  readonly url: string
  readonly scope: string | null
  status?: number
  failure?: string
}

type AlertSample = {
  readonly at: number
  readonly document: number
  readonly documentId: string
  readonly alerts: readonly string[]
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(50)
  }
  ok(false, label)
}

export const watcherRestart: Scenario = {
  name: NAME,
  description:
    'Reload during an actual 8 s throwaway server restart: fresh filesystem subscriptions fail and recover, disk changes reach the tree, and no transient filesystem toast appears.',
  requiresIsolatedServer: true,
  async run(page, { step, server, evidence }) {
    ok(server, `${NAME} requires the throwaway API server; drop --shared-dev`)
    const fixture = await mkdtemp(scratchPath('fregat-watcher-restart-'))
    const started = Date.now()
    let document = 0
    const requests: WatchRequest[] = []
    const alerts: AlertSample[] = []
    const byRequest = new Map<Request, WatchRequest>()
    const health: { at: number; healthy: boolean }[] = []
    const documents: { at: number; document: number; url: string }[] = []
    const onNavigation = (frame: ReturnType<Page['mainFrame']>) => {
      if (frame !== page.mainFrame()) return
      document += 1
      documents.push({ at: Date.now() - started, document, url: frame.url() })
    }
    const onRequest = (request: Request) => {
      const url = new URL(request.url())
      if (url.origin !== server.origin || !url.pathname.endsWith('/fs/events')) return
      const record: WatchRequest = {
        at: Date.now() - started,
        document,
        url: request.url(),
        scope: url.searchParams.get('scope'),
      }
      byRequest.set(request, record)
      requests.push(record)
    }
    const onResponse = (response: Response) => {
      const record = byRequest.get(response.request())
      if (record) record.status = response.status()
    }
    const onFailure = (request: Request) => {
      const record = byRequest.get(request)
      if (record) record.failure = request.failure()?.errorText ?? 'request failed'
    }
    page.on('framenavigated', onNavigation)
    page.on('request', onRequest)
    page.on('response', onResponse)
    page.on('requestfailed', onFailure)
    // The samples live in Node: a fresh document cannot erase a short-lived toast.
    await page.exposeBinding(
      'recordWatcherRestartAlerts',
      (
        { frame },
        sample: {
          documentId: string
          alerts: string[]
        },
      ) => {
        if (frame !== page.mainFrame()) return
        alerts.push({ at: Date.now() - started, document, ...sample })
      },
    )
    await page.addInitScript((selector) => {
      const documentId = crypto.randomUUID()
      const report = () => {
        const alerts = Array.from(globalThis.document.querySelectorAll<HTMLElement>(selector))
          .map((element) => element.innerText.trim())
          .filter(Boolean)
        void (
          window as unknown as {
            recordWatcherRestartAlerts: (sample: unknown) => Promise<void>
          }
        )
          .recordWatcherRestartAlerts({ documentId, alerts })
          .catch(() => undefined)
      }
      new MutationObserver(report).observe(globalThis.document, {
        subtree: true,
        childList: true,
        characterData: true,
      })
      globalThis.document.addEventListener('DOMContentLoaded', report, { once: true })
      setInterval(report, 50)
    }, transientAlertSelector)
    const isHealthy = async () => {
      const healthy = await fetch(`${server.origin}/health`, {
        headers: { Origin: new URL(page.url()).origin },
        signal: AbortSignal.timeout(1000),
      }).then(
        (response) => response.ok,
        () => false,
      )
      health.push({ at: Date.now() - started, healthy })
      return healthy
    }
    let reloadedDocument: number | null = null
    try {
      await writeFile(join(fixture, 'before-restart.txt'), 'before\n')
      await openFixtureWorkspace(page, fixture)
      await selectors.treeItem(page, 'before-restart.txt').waitFor()
      await waitUntil(
        () => requests.some((request) => request.document === document && request.status === 200),
        'A known-good document must open a real filesystem event stream',
      )
      await step('watching-before-restart')
      await stageRelease(server)
      server.restartDelayMs = RESTART_DELAY_MS
      const restart = await page.request.post(`${server.origin}/server/restart`, {
        data: { interrupt: [] },
        headers: { Origin: new URL(page.url()).origin },
      })
      ok(restart.ok(), `The throwaway restart must be accepted: ${restart.status()}`)
      ok((await restart.json()).restarting === true, 'The restart must actually stop the server')
      await waitUntil(async () => !(await isHealthy()), 'The server must actually go down')
      await page.reload({ waitUntil: 'domcontentloaded' })
      reloadedDocument = document
      await waitUntil(
        () =>
          requests.some(
            (request) =>
              request.document === reloadedDocument &&
              request.failure !== undefined &&
              !/abort/i.test(request.failure),
          ),
        'The fresh document must attempt fs/events and fail against the stopped server',
      )
      await step('fresh-document-watch-failed-during-restart')
      await writeFile(join(fixture, 'created-during-restart.txt'), 'during\n')
      await waitUntil(isHealthy, 'The throwaway server must become healthy again')
      await waitUntil(
        () =>
          requests.some(
            (request) => request.document === reloadedDocument && request.status === 200,
          ),
        'The fresh document must recover its filesystem event stream without another reload',
      )
      await selectors.treeItem(page, 'created-during-restart.txt').waitFor({ timeout: 20_000 })
      await step('watch-recovered-and-tree-resynced')
      // A post-recovery disk mutation proves live delivery, beyond a one-time tree refetch.
      await writeFile(join(fixture, 'created-after-restart.txt'), 'after\n')
      await selectors.treeItem(page, 'created-after-restart.txt').waitFor({ timeout: 20_000 })
      await step('live-watch-delivers-after-restart')
      await page.waitForTimeout(500)
      const filesystemAlerts = [...new Set(alerts.flatMap((sample) => sample.alerts))].filter(
        (alert) => FILESYSTEM_ALERT.test(alert),
      )
      ok(
        alerts.some((sample) => sample.document === reloadedDocument),
        'The fresh document must report alert samples to the surviving Node observer',
      )
      ok(
        filesystemAlerts.length === 0,
        `A transient restart must show no filesystem alert: ${filesystemAlerts.join(' | ')}`,
      )
    } finally {
      await evidence.json('watcher-restart.json', {
        restartDelayMs: RESTART_DELAY_MS,
        reloadedDocument,
        documents,
        health,
        requests,
        alerts,
      })
      page.off('framenavigated', onNavigation)
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('requestfailed', onFailure)
      await page
        .evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
        .catch(() => undefined)
      await releaseFixture(fixture)
    }
  },
}
