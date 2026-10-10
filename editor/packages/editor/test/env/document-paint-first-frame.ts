import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { build, serve } from 'bun'

export async function proveDocumentPaintFirstFrame(
  page: Page,
  project: string,
  evidence: string,
  payload: string,
  markup: string,
  width: number,
  javaScriptEnabled: boolean,
  activationMode: 'success' | 'refused' | 'throws' | 'missing' | 'missing-deferred' = 'success',
) {
  const entry = join(evidence, 'activate-document-paint.ts')
  const source = join(import.meta.dirname, '../../src/paint.ts')
  writeFileSync(
    entry,
    `import { decodePaintSnapshot, activatePaintSnapshotHighlights, preparePaintSnapshotHighlights } from ${JSON.stringify(source)}; window.__paintProof = { decodePaintSnapshot, activatePaintSnapshotHighlights }; preparePaintSnapshotHighlights(document);`,
  )
  const activation = await build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: true,
    metafile: true,
  })
  const paintEntry = await build({
    entrypoints: [source],
    target: 'browser',
    format: 'esm',
    minify: true,
    metafile: true,
  })
  if (!activation.success || !paintEntry.success) throw activation.logs.concat(paintEntry.logs)
  const bundle = await activation.outputs[0]!.text()
  const paintBundle = await paintEntry.outputs[0]!.text()
  const sizes = {
    activation: { bytes: Buffer.byteLength(bundle), gzipBytes: gzipSync(bundle).byteLength },
    paint: { bytes: Buffer.byteLength(paintBundle), gzipBytes: gzipSync(paintBundle).byteLength },
  }
  writeFileSync(join(evidence, 'paint-entry-size.json'), JSON.stringify(sizes, null, 2))
  writeFileSync(
    join(evidence, 'activation-metafile.json'),
    JSON.stringify(activation.metafile, null, 2),
  )
  writeFileSync(
    join(evidence, 'paint-entry-metafile.json'),
    JSON.stringify(paintEntry.metafile, null, 2),
  )
  const inputs = Object.keys(activation.metafile!.inputs)
  const fonts = ['jetbrains-mono.woff2', 'source-serif-4.woff2']
    .map((name, index) => {
      const bytes = readFileSync(join(import.meta.dirname, '../fixtures/fonts', name)).toString(
        'base64',
      )
      const family = index ? 'Snapshot Serif' : 'Snapshot Mono'
      return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${bytes})}`
    })
    .join('')
  const context = await page
    .context()
    .browser()!
    .newContext({
      javaScriptEnabled,
      deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
      viewport: { width: 1400, height: 900 },
    })
  const safePayload = payload.replaceAll('<', '\\u003c')
  let finishDeferred: (() => void) | undefined
  const deferred = new Promise<Response>((resolve) => {
    finishDeferred = () =>
      resolve(
        new Response('window.__paintDeferredLoaded=true', {
          headers: { 'Content-Type': 'text/javascript' },
        }),
      )
  })
  const deferredScript =
    activationMode === 'missing-deferred'
      ? '<script defer src="/document-paint-deferred-proof.js"></script>'
      : ''
  const prefix = `<!doctype html><html><head><style>body{margin:0}${fonts}</style><script>${bundle.replaceAll('</script', '<\\/script')}</script>${deferredScript}</head><body><script type="application/json" id="paint-payload">${safePayload}</script><div id="document-paint-proof" style="position:relative;width:${width}px">${markup}</div>`
  const activationCall = `const root=document.querySelector('[data-editor-document-paint]');try{${activationMode === 'refused' ? "root.querySelector('[data-editor-document-paint-source-row]').dataset.editorDocumentPaintStart='1';" : ''}${activationMode === 'throws' ? "CSSStyleSheet.prototype.insertRule=()=>{throw 'activation proof failure'};" : ''}window.__paintProofHandles=[window.__paintProof.activatePaintSnapshotHighlights(root,window.__paintProof.decodePaintSnapshot(document.querySelector('#paint-payload').textContent))];if(window.__paintProofHandles[0])root.dataset.paintActivated='true';}catch{root.dataset.paintFailed='true';}`
  const tail = `${activationMode.startsWith('missing') ? '' : `<script>${activationCall}</script>`}</body></html>`
  let finishStream: (() => Promise<void>) | undefined
  const encoder = new TextEncoder()
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === '/document-paint-deferred-proof.js') return deferred
      if (path !== '/document-paint-first-frame-proof') return new Response(null, { status: 404 })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(prefix))
            const held = new Promise<void>((resolve) =>
              setTimeout(resolve, javaScriptEnabled ? 1500 : 0),
            )
            finishStream = async () => {
              await held
              controller.enqueue(encoder.encode(tail))
              controller.close()
            }
          },
        }),
        { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } },
      )
    },
  })
  const url = `http://127.0.0.1:${server.port}/document-paint-first-frame-proof`
  try {
    const fresh = await context.newPage()
    let firstImage: Buffer | undefined
    let captureStarted = false
    await fresh.exposeFunction('__capturePaintFrame', async () => {
      if (captureStarted) return
      captureStarted = true
      firstImage = await fresh.locator('#document-paint-proof').screenshot({ animations: 'allow' })
      await fresh.evaluate(() => {
        ;(window as unknown as { __paintFirstFrameCaptured: boolean }).__paintFirstFrameCaptured =
          true
      })
    })
    await fresh.addInitScript({
      content: `window.__paintFrames=[];let remaining=1200;function observe(){const root=document.querySelector('[data-editor-document-paint]');if(root){window.__paintFrames.push({visible:getComputedStyle(root).visibility==='visible',activated:root.dataset.paintActivated==='true',highlights:CSS.highlights.size});if(getComputedStyle(root).visibility==='visible'&&document.fonts.status==='loaded')window.__capturePaintFrame();}if(--remaining>0&&!window.__stopPaintFrames)requestAnimationFrame(observe)}requestAnimationFrame(observe);`,
    })
    await fresh.goto(url, { waitUntil: 'commit' })
    await fresh.locator('[data-editor-document-paint]').waitFor({ state: 'attached' })
    const pending = await fresh.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-editor-document-paint]')!
      return {
        visibility: getComputedStyle(root).visibility,
        height: root.getBoundingClientRect().height,
        loading: document.readyState === 'loading',
      }
    })
    await finishStream!()
    let parsed = null
    if (activationMode === 'missing-deferred') {
      await fresh.waitForFunction(() => document.readyState === 'interactive')
      parsed = await fresh.evaluate(() => ({
        visibility: getComputedStyle(document.querySelector('[data-editor-document-paint]')!)
          .visibility,
        gatePending: document.documentElement.classList.contains('editor-document-paint-pending'),
        deferredLoaded:
          (window as unknown as { __paintDeferredLoaded?: boolean }).__paintDeferredLoaded === true,
        readyState: document.readyState,
      }))
      finishDeferred!()
    }
    await fresh.waitForLoadState('load')
    await fresh.evaluate(() => document.fonts.ready)
    if (javaScriptEnabled)
      await fresh.waitForFunction(
        () =>
          (window as unknown as { __paintFirstFrameCaptured: boolean })
            .__paintFirstFrameCaptured === true,
      )
    const settledImage = await fresh
      .locator('#document-paint-proof')
      .screenshot({ animations: 'allow' })
    const firstFrame = javaScriptEnabled ? firstImage! : settledImage
    const fixture = markup.includes('role="heading"') ? 'markdown' : 'code'
    writeFileSync(
      join(
        evidence,
        `${project}-${width}-${fixture}-${javaScriptEnabled ? `first-frame-${activationMode}` : 'javascript-off'}.png`,
      ),
      firstFrame,
    )
    const result = await fresh.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-editor-document-paint]')!
      const bounds = root.getBoundingClientRect()
      const state = window as unknown as {
        __stopPaintFrames: boolean
        __paintFrames?: { activated: boolean; highlights: number }[]
      }
      state.__stopPaintFrames = true
      return {
        visibility: getComputedStyle(root).visibility,
        gatePending: document.documentElement.classList.contains('editor-document-paint-pending'),
        text: root.textContent,
        height: bounds.height,
        rows: [...root.querySelectorAll<HTMLElement>('[data-editor-document-paint-row]')].map(
          (row) => {
            const rect = row.getBoundingClientRect()
            return {
              text: row.textContent,
              x: rect.x - bounds.x,
              y: rect.y - bounds.y,
              width: rect.width,
              height: rect.height,
            }
          },
        ),
        heading: root.querySelector('[role=heading]')?.getAttribute('aria-label'),
        link: root.querySelector('a')?.getAttribute('href'),
        frames: state.__paintFrames ?? [],
      }
    })
    const counts: number[] = []
    if (javaScriptEnabled && activationMode === 'success') {
      counts.push(await fresh.evaluate(() => CSS.highlights.size))
      await fresh.addScriptTag({ content: bundle })
      counts.push(
        await fresh.evaluate((payload) => {
          const state = window as unknown as {
            __paintProof: {
              decodePaintSnapshot(value: string): unknown
              activatePaintSnapshotHighlights(
                root: HTMLElement,
                paint: unknown,
              ): { dispose(): void }
            }
            __paintProofHandles: { dispose(): void }[]
          }
          const clone = document
            .querySelector<HTMLElement>('[data-editor-document-paint]')!
            .cloneNode(true) as HTMLElement
          document.body.append(clone)
          state.__paintProofHandles.push(
            state.__paintProof.activatePaintSnapshotHighlights(
              clone,
              state.__paintProof.decodePaintSnapshot(payload),
            ),
          )
          return CSS.highlights.size
        }, payload),
      )
      counts.push(
        await fresh.evaluate(() => {
          const state = window as unknown as { __paintProofHandles: { dispose(): void }[] }
          state.__paintProofHandles[0]!.dispose()
          return CSS.highlights.size
        }),
      )
      await fresh.addScriptTag({ content: bundle })
      counts.push(
        await fresh.evaluate((payload) => {
          const state = window as unknown as {
            __paintProof: {
              decodePaintSnapshot(value: string): unknown
              activatePaintSnapshotHighlights(
                root: HTMLElement,
                paint: unknown,
              ): { dispose(): void }
            }
            __paintProofHandles: { dispose(): void }[]
          }
          const clone = document
            .querySelector<HTMLElement>('[data-editor-document-paint]')!
            .cloneNode(true) as HTMLElement
          document.body.append(clone)
          state.__paintProofHandles.push(
            state.__paintProof.activatePaintSnapshotHighlights(
              clone,
              state.__paintProof.decodePaintSnapshot(payload),
            ),
          )
          return CSS.highlights.size
        }, payload),
      )
      counts.push(
        await fresh.evaluate(() => {
          const state = window as unknown as { __paintProofHandles: { dispose(): void }[] }
          state.__paintProofHandles[0]!.dispose()
          return CSS.highlights.size
        }),
      )
    }
    const proof = { ...result, pending, parsed, sizes, inputs, counts }
    writeFileSync(
      join(
        evidence,
        `${project}-${width}-${fixture}-${javaScriptEnabled ? `first-frame-${activationMode}` : 'javascript-off'}.json`,
      ),
      JSON.stringify(proof, null, 2),
    )
    return { ...proof, image: firstFrame.toString('base64') }
  } finally {
    finishDeferred!()
    await context.close()
    server.stop(true)
  }
}
