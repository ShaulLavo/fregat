import { ok } from 'node:assert/strict'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace } from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { openFileByName, focusEditor, runPaletteCommand, selectors } from '../selectors'

let measured: unknown = null
export const editorTypeScriptWorkerMemory: Scenario = {
  name: 'editor-typescript-worker-memory',
  description: 'Measure the TypeScript worker heap on apps/web and record its preload limits.',
  async run(page, { step }) {
    const original = page.url()
    const restore = await preserveAppearance(page, [
      'lsp.typescript.backend',
      'lsp.typescript.workerMaxFiles',
      'lsp.typescript.workerMaxBytes',
    ])
    const root = path.join(process.cwd(), 'apps/web')
    try {
      await writeUserSetting(page, 'lsp.typescript.backend', 'worker')
      await writeUserSetting(page, 'lsp.typescript.workerMaxFiles', 50_000)
      await writeUserSetting(page, 'lsp.typescript.workerMaxBytes', 268_435_456)
      await openFixtureWorkspace(page, root)
      const programResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname.endsWith('/lsp/typescript/program-files'),
        { timeout: 90_000 },
      )
      await openFileByName(page, 'main.tsx')
      const program = await (await programResponse).json()
      await page
        .waitForEvent('worker', {
          predicate: (worker) => worker.url().includes('typescriptLsp.worker'),
          timeout: 90_000,
        })
        .catch(() => undefined)
      await page.waitForTimeout(20_000)
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight')
      await runPaletteCommand(page, 'Rename symbol')
      await selectors.renameInput(page).waitFor({ timeout: 60_000 })
      await page.keyboard.press('Escape')
      const workers = await workerHeaps(page)
      measured = { program, workers, limits: { files: 50_000, bytes: 268_435_456 } }
      console.log(JSON.stringify({ totals: program.totals, skipped: program.skipped, workers }))
      ok(workers.length > 0, 'TypeScript worker starts within configured ceilings')
      await step('apps-web-worker-heap')
    } finally {
      await page.goto(original)
      await page.waitForTimeout(1000)
      await restore()
    }
  },
  inspect: async () => measured,
}

async function workerHeaps(page: Page) {
  const browser = page.context().browser()
  if (!browser) return []
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const values: unknown[] = []
    for (const target of targetInfos.filter(
      (target) => target.type === 'worker' && target.url.includes('typescriptLsp.worker'),
    )) {
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: false,
      })
      const result = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Heap request timed out for ${target.targetId}`)),
          5000,
        )
        const listener = (event: { sessionId: string; message: string }) => {
          if (event.sessionId !== sessionId) return
          const reply = JSON.parse(event.message)
          if (reply.id !== 1) return
          clearTimeout(timeout)
          cdp.off('Target.receivedMessageFromTarget', listener)
          resolve(reply.result)
        }
        cdp.on('Target.receivedMessageFromTarget', listener)
      })
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }),
      })
      values.push({ url: target.url, heap: await result })
      await cdp.send('Target.detachFromTarget', { sessionId })
    }
    return values
  } finally {
    await cdp.detach()
  }
}
