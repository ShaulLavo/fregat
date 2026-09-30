import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      commands: {
        proofKeyPress: async ({ page }, key: string) => {
          await page.keyboard.press(key)
        },
        proofType: async ({ page }, text: string) => {
          await page.keyboard.type(text)
        },
        proofImeComposition: async (
          { page },
          text: string,
          replacement: readonly [number, number] | null = null,
        ) => {
          const cdp = await page.context().newCDPSession(page)
          const range = replacement
            ? { replacementStart: replacement[0], replacementEnd: replacement[1] }
            : {}
          await cdp.send('Input.imeSetComposition', {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
            ...range,
          })
          await cdp.detach()
        },
        proofInsertText: async ({ page }, text: string) => {
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Input.insertText', { text })
          await cdp.detach()
        },
      },
      instances: [{ browser: 'chromium' }],
    },
    include: ['test/**/*.test.ts'],
  },
})
