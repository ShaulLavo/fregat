import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@workspace/ui/globals.css': path.resolve(__dirname, './src/styles/globals.css'),
      '@workspace/ui': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  // Discovered mid-run, Base UI makes Vite reload the page and load a second React.
  optimizeDeps: {
    include: [
      '@base-ui/react/tooltip',
      '@base-ui/react/button',
      '@base-ui/react/switch',
      'class-variance-authority',
    ],
  },
  test: {
    name: 'browser',
    include: ['src/patterns/tests/*.browser.tsx'],
    setupFiles: ['./test/env/dom.ts'],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: {
        async rowKey(context, selector: string, key: string) {
          const frame = await context.frame()
          await frame.locator(selector).press(key)
        },
        async rowPointer(context, selector: string, pressed: boolean) {
          const frame = await context.frame()
          const row = frame.locator(selector)
          await row.hover()
          if (pressed) await context.page.mouse.down()
          else await context.page.mouse.up()
        },
      },
    },
  },
})
