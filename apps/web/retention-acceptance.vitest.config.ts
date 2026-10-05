import { defineConfig } from 'vitest/config'
import type { BrowserCommandContext } from 'vitest/node'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScriptError } from '../../scripts/structured-errors.ts'
import { errorMessage } from '../../packages/contracts/src/error-fields'
import base from './vitest.browser.config.ts'
import {
  createRetentionReloadTransport,
  archiveRetentionReloadFailure,
  archiveRetentionReloadArtifact,
  settleRetentionReloadCleanup,
} from './test/factories/retention-acceptance-reload-transport'
import type {} from './test/factories/retention-acceptance-entry.tsx'

export default defineConfig(({ mode }) =>
  mode === 'retention-acceptance-entry'
    ? {
        ...base,
        root: import.meta.dirname,
        test: undefined,
      }
    : {
        ...base,
        root: import.meta.dirname,
        test: {
          ...base.test,
          globalSetup: ['./test/env/retention-acceptance-file-server.ts'],
          provide: { retentionAcceptanceEntryUrl: 'http://127.0.0.1:52865' },
          include: ['src/features/editor/tests/retention-acceptance-reload.browser.tsx'],
          exclude: base.test?.exclude?.filter(
            (path) => path !== 'src/features/editor/tests/retention-acceptance-reload.browser.tsx',
          ),
          browser: {
            ...base.test?.browser,
            commands: { ...base.test?.browser?.commands, retentionAcceptanceReload },
          },
        },
      },
)

type ReloadArm = {
  readonly syntax: 'colored' | 'plain'
  readonly font: 'normal' | 'slow'
  readonly saved: 'present' | 'absent'
}

async function retentionAcceptanceReload(context: BrowserCommandContext, arm: ReloadArm) {
  const browser = context.context.browser()
  if (!browser) throw createScriptError('Retention acceptance isolated browser is unavailable')
  const isolated = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1200, height: 800 },
  })
  const page = await isolated.newPage()
  const runnerOrigin = new URL(context.page.url()).origin
  const entryOrigin = context.project.getProvidedContext().retentionAcceptanceEntryUrl
  await isolated.grantPermissions(['local-network-access'], { origin: runnerOrigin })
  let reloading = false
  const delayedFonts: { url: string; heldAt: number; releasedAt: number }[] = []
  const transport = createRetentionReloadTransport()
  await page.route(
    (url) => url.origin === runnerOrigin,
    (route) => {
      return transport.run(
        route.request().url(),
        async () => {
          const request = new URL(route.request().url())
          if (
            reloading &&
            arm.font === 'slow' &&
            request.pathname.includes('jetbrains-mono') &&
            request.pathname.endsWith('.woff2')
          ) {
            const heldAt = Date.now()
            await new Promise<void>((resolve) => setTimeout(resolve, 1000))
            delayedFonts.push({ url: request.href, heldAt, releasedAt: Date.now() })
          }
          const response = await route.fetch({
            url: new URL(request.pathname + request.search, entryOrigin).href,
          })
          await route.fulfill({ response })
        },
        () => route.abort('failed'),
      )
    },
  )
  const output = await mkdtemp(join(tmpdir(), 'retention-acceptance-reload-'))
  const errors: string[] = []
  const pending = new Set<string>()
  const consoleMessages: { readonly type: string; readonly text: string }[] = []
  page.on('request', (request) => pending.add(request.url()))
  page.on('requestfinished', (request) => pending.delete(request.url()))
  const requestFailures: { url: string; at: number; error: string | null }[] = []
  page.on('requestfailed', (request) => {
    pending.delete(request.url())
    requestFailures.push({
      url: request.url(),
      at: Date.now(),
      error: request.failure()?.errorText ?? null,
    })
  })
  page.on('console', (message) =>
    consoleMessages.push({ type: message.type(), text: message.text() }),
  )
  const responses: { readonly url: string; readonly status: number }[] = []
  let phase = 'entry'
  page.on('response', (response) =>
    responses.push({ url: response.url(), status: response.status() }),
  )
  page.on('pageerror', (error) => errors.push(error.message))
  const operation = (async () => {
    await page.goto(new URL('/test/factories/retention-acceptance-entry.html', runnerOrigin).href)
    phase = 'entry-owner'
    await page.waitForFunction(() => Boolean(window.__retentionAcceptanceEntry), undefined, {
      timeout: 15_000,
    })
    phase = 'fixture-open'
    await page.evaluate(async (syntax) => {
      const owner = window.__retentionAcceptanceEntry
      if (!owner) return
      await owner.setSyntaxEnabled(syntax === 'colored')
      await owner.openFixture()
    }, arm.syntax)
    phase = 'baseline-ready'
    await waitForRetentionAcceptanceEntry(page)
    const before = await page.evaluate(() => window.__retentionAcceptanceEntry?.capture())
    await page.addInitScript((saved) => {
      const savedKeys = Object.keys(localStorage).filter((key) =>
        key.includes('editorVisibleSnapshot'),
      )
      const priorSavedRecords = savedKeys.map((key) => ({
        key,
        serialized: localStorage.getItem(key),
      }))
      if (saved === 'absent') for (const key of savedKeys) localStorage.removeItem(key)
      window.__retentionAcceptanceReloadCacheReceipt = {
        priorSavedKeys: savedKeys,
        priorSavedRecords,
        remainingSavedKeys: Object.keys(localStorage).filter((key) =>
          key.includes('editorVisibleSnapshot'),
        ),
      }
      const frames: ReloadFrame[] = []
      const readRow = (row: HTMLElement) => {
        const runs: ReloadRow['runs'][number][] = []
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let offset = 0
        let text = walker.nextNode()
        while (text) {
          const content = text.textContent ?? ''
          const style = getComputedStyle(text.parentElement ?? row)
          runs.push({
            start: offset,
            end: offset + content.length,
            text: content,
            style: {
              color: style.color,
              backgroundColor: style.backgroundColor,
              textDecoration: style.textDecorationLine,
              textDecorationColor: style.textDecorationColor,
              textDecorationStyle: style.textDecorationStyle,
              textDecorationThickness: style.textDecorationThickness,
            },
          })
          offset += content.length
          text = walker.nextNode()
        }
        return {
          text: row.textContent,
          html: row.outerHTML,
          visible: row.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          runs,
        }
      }
      Object.defineProperty(window, '__retentionAcceptanceReloadFrames', {
        value: frames,
        configurable: true,
      })
      const tick = () => {
        const input = document.querySelector<HTMLElement>('.editor-virtualized-input')
        const selectedTab = document.querySelector<HTMLElement>(
          '[data-editor-tab-id][aria-selected="true"]',
        )
        frames.push({
          at: performance.now(),
          editor: Boolean(document.querySelector('.editor-virtualized')),
          rows: [...document.querySelectorAll<HTMLElement>('.editor-virtualized-row')].map(readRow),
          fonts: {
            status: document.fonts.status,
            codeLoaded: document.fonts.check('13px "JetBrains Mono Variable"'),
          },
          input: {
            mounted: Boolean(input),
            readonly:
              input?.getAttribute('aria-readonly') === 'true' ||
              (input instanceof HTMLTextAreaElement && input.readOnly),
            disabled: input instanceof HTMLTextAreaElement && input.disabled,
          },
          header: {
            tabId: selectedTab?.dataset.editorTabId ?? null,
            groupId:
              selectedTab?.closest<HTMLElement>('[data-editor-group-id]')?.dataset.editorGroupId ??
              null,
            path: selectedTab?.dataset.editorTabPath ?? null,
            busy: selectedTab?.getAttribute('aria-busy') === 'true',
            loading: selectedTab?.dataset.editorTabLoading === 'true',
          },
          observation: window.__retentionAcceptanceEntry?.capture() ?? null,
        })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, arm.saved)
    phase = 'reload'
    reloading = true
    await page.reload()
    await waitForRetentionAcceptanceEntry(page)
    phase = 'code-font-loaded'
    const fontLoadReceipt = await page.evaluate(async () => {
      const font = '13px "JetBrains Mono Variable"'
      const faces = await document.fonts.load(font)
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return {
        faceCount: faces.length,
        families: faces.map((face) => face.family),
        status: document.fonts.status,
        codeLoaded:
          faces.length > 0 &&
          faces.every((face) => face.status === 'loaded') &&
          document.fonts.check(font),
      }
    })
    const after = await page.evaluate(() => window.__retentionAcceptanceEntry?.capture())
    const frames = await page.evaluate(() => window.__retentionAcceptanceReloadFrames)
    const cacheReceipt = await page.evaluate(() => window.__retentionAcceptanceReloadCacheReceipt)
    const screenshot = join(output, 'page.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    const result = {
      arm,
      before,
      after,
      frames,
      cacheReceipt,
      delayedFonts,
      fontLoadReceipt,
      setup: {
        entryOrigin,
        runnerOrigin,
        permission: 'local-network-access',
        permissionOrigin: runnerOrigin,
      },
      errors,
      responses,
      requestFailures,
      output,
      screenshot,
    }
    if (transport.failures.length > 0) throw transport.firstError
    await writeFile(join(output, 'raw.json'), JSON.stringify(result))
    return result
  })()
  const artifactFailures: unknown[] = []
  let cleanupFailures: unknown[] = []
  const outcome = await transport
    .race(operation)
    .then(
      (result) => ({ kind: 'success' as const, result }),
      async (error: unknown) => {
        const frames = await page
          .evaluate(() => window.__retentionAcceptanceReloadFrames)
          .catch(() => null)
        const setup = await page
          .evaluate(() => ({
            bootstrap: window.__retentionAcceptanceBootstrap?.() ?? null,
            owner: Boolean(window.__retentionAcceptanceEntry),
            observation: window.__retentionAcceptanceEntry?.capture() ?? null,
            dom: document.body.innerHTML,
          }))
          .catch(() => null)
        await page
          .screenshot({ path: join(output, 'failure.png'), fullPage: true })
          .catch(() => undefined)
        artifactFailures.push(
          ...(await archiveRetentionReloadFailure(output, {
            arm,
            phase,
            pending: [...pending],
            consoleMessages,
            setup,
            responses,
            requestFailures,
            frames,
            errors,
            failure: error instanceof Error ? error.message : String(error),
            transportFailures: transport.failures,
          })),
        )
        return { kind: 'failure' as const, error }
      },
    )
    .finally(async () => {
      const cleanup = await settleRetentionReloadCleanup([
        { stage: 'cancel-forwarding', run: () => isolated.request.dispose() },
        {
          stage: 'restore-syntax',
          run: () => page.evaluate(() => window.__retentionAcceptanceEntry?.setSyntaxEnabled(true)),
        },
        { stage: 'unroute', run: () => page.unrouteAll({ behavior: 'default' }) },
        {
          stage: 'archive-final-frames',
          run: async () => {
            artifactFailures.push(
              ...(await archiveFinalRetentionReloadFrames(page, output, {
                phase,
                transportFailures: transport.failures,
                requestFailures,
              })),
            )
          },
        },
        { stage: 'close-context', run: () => isolated.close() },
        { stage: 'drain-routes', run: () => transport.drain() },
      ])
      artifactFailures.push(
        ...(await archiveRetentionReloadArtifact(output, 'cleanup.json', {
          phase,
          requestFailures,
          transportFailures: transport.failures,
          artifactFailures: artifactFailures.map(errorMessage),
          cleanup: cleanup.map((outcome) => ({
            ...outcome,
            error: outcome.error === null ? null : errorMessage(outcome.error),
          })),
        })),
      )
      cleanupFailures = cleanup
        .filter((result) => result.error !== null)
        .map((result) => result.error)
    })
  if (outcome.kind === 'failure') throw outcome.error
  if (transport.failures.length > 0) throw transport.firstError
  if (cleanupFailures.length > 0) throw cleanupFailures[0]
  if (artifactFailures.length > 0) throw artifactFailures[0]
  return outcome.result
}

async function archiveFinalRetentionReloadFrames(
  page: BrowserCommandContext['page'],
  output: string,
  facts: Record<string, unknown>,
) {
  const final = await page
    .evaluate(() => ({
      frames: window.__retentionAcceptanceReloadFrames ?? null,
      observation: window.__retentionAcceptanceEntry?.capture() ?? null,
    }))
    .catch((error: unknown) => ({ failure: errorMessage(error) }))
  return archiveRetentionReloadArtifact(output, 'final-raw.json', { ...facts, final })
}

function waitForRetentionAcceptanceEntry(page: BrowserCommandContext['page']) {
  return page.waitForFunction(
    () => {
      const observation = window.__retentionAcceptanceEntry?.capture()
      return (
        observation?.kind === 'mounted' &&
        observation.views.some((view) => view.kind === 'observed' && view.mismatch === null)
      )
    },
    undefined,
    { timeout: 15_000 },
  )
}

declare global {
  interface Window {
    __retentionAcceptanceReloadFrames?: readonly ReloadFrame[]
    __retentionAcceptanceReloadCacheReceipt?: {
      readonly priorSavedKeys: readonly string[]
      readonly remainingSavedKeys: readonly string[]
      readonly priorSavedRecords: readonly {
        readonly key: string
        readonly serialized: string | null
      }[]
    }
  }
}

type ReloadFrame = {
  readonly at: number
  readonly editor: boolean
  readonly rows: readonly ReloadRow[]
  readonly fonts: { readonly status: string; readonly codeLoaded: boolean }
  readonly input: {
    readonly mounted: boolean
    readonly readonly: boolean
    readonly disabled: boolean
  }
  readonly header: {
    readonly tabId: string | null
    readonly groupId: string | null
    readonly path: string | null
    readonly busy: boolean
    readonly loading: boolean
  }
  readonly observation: ReturnType<
    NonNullable<Window['__retentionAcceptanceEntry']>['capture']
  > | null
}

type ReloadRow = {
  readonly text: string | null
  readonly html: string
  readonly visible: boolean
  readonly runs: readonly {
    readonly start: number
    readonly end: number
    readonly text: string
    readonly style: Record<string, string>
  }[]
}

export type RetentionAcceptanceReloadResult = Awaited<ReturnType<typeof retentionAcceptanceReload>>

declare module 'vitest' {
  interface ProvidedContext {
    retentionAcceptanceEntryUrl: string
  }
}
