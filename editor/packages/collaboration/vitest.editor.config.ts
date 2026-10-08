import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { workspaceRoot } from '../../scripts/workspace-root.ts'

export default defineConfig({
  // This config resolves editor source; transport tests resolve its built package.
  cacheDir: resolve(import.meta.dirname, 'node_modules/.vite-editor'),
  resolve: {
    alias: {
      '@singapore-editor/core/document': resolve(
        import.meta.dirname,
        '../editor/src/public/document.ts',
      ),
      '@singapore-editor/core/editor': resolve(import.meta.dirname, '../editor/src/editor.ts'),
      '@singapore-editor/core/extensions': resolve(
        import.meta.dirname,
        '../editor/src/public/extensions.ts',
      ),
      '@singapore-editor/collaboration/transports': resolve(
        import.meta.dirname,
        'src/transports.ts',
      ),
      '@singapore-editor/collaboration': resolve(import.meta.dirname, 'src/index.ts'),
    },
  },
  define: { __COLLABORATION_MEASURE__: JSON.stringify(Boolean(process.env.COLLABORATION_MEASURE)) },
  server: { fs: { allow: [workspaceRoot] } },
  test: {
    include: ['test/editor*.browser.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 1200, height: 650 },
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: {
        editorType: async ({ page }, text: string) => {
          await page.keyboard.type(text)
        },
        editorPaste: async ({ page, iframe }, text: string) => {
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
          await iframe
            .locator('body')
            .evaluate(async (_body, value) => navigator.clipboard.writeText(value), text)
          await page.keyboard.press('ControlOrMeta+V')
        },
        editorIME: async ({ page }, text: string, commit: boolean) => {
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Input.imeSetComposition', {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
          })
          if (commit) await cdp.send('Input.insertText', { text })
          await cdp.detach()
        },
        editorLook: async ({ iframe }, label: string) => {
          if (!process.env.COLLABORATION_EVIDENCE_DIR) return
          const directory = resolve(process.env.COLLABORATION_EVIDENCE_DIR)
          await mkdir(directory, { recursive: true })
          await iframe
            .locator('#collaboration-editors')
            .screenshot({ path: resolve(directory, `${label}.png`), animations: 'disabled' })
        },
        editorExperiment: async (_context, data: unknown) => {
          if (!process.env.COLLABORATION_EVIDENCE_DIR) return
          const directory = resolve(process.env.COLLABORATION_EVIDENCE_DIR)
          await mkdir(directory, { recursive: true })
          await writeFile(resolve(directory, 'experiment.json'), JSON.stringify(data, null, 2))
        },
      },
    },
  },
})
