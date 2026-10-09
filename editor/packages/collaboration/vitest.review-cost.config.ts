import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import editor from './vitest.editor.config.ts'

export default defineConfig({
  ...editor,
  optimizeDeps: { include: ['@singapore-editor/tree-sitter > tree-sitter-md', 'web-tree-sitter'] },
  test: {
    ...editor.test,
    include: ['bench/runtime.browser.test.ts'],
    testTimeout: 240_000,
    browser: {
      ...editor.test!.browser,
      commands: {
        ...editor.test!.browser!.commands,
        editorLook: async ({ iframe }, label: string) => {
          if (!process.env.COLLABORATION_EVIDENCE_DIR) return
          const directory = resolve(process.env.COLLABORATION_EVIDENCE_DIR)
          await mkdir(directory, { recursive: true })
          await iframe
            .locator('body')
            .screenshot({ path: resolve(directory, `${label}.png`), animations: 'disabled' })
        },
      },
    },
  },
})
