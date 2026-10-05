import { defineConfig } from 'vitest/config'
import type { BrowserCommandContext } from 'vitest/node'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import base from './vitest.browser.config'

export default defineConfig({
  ...base,
  root: import.meta.dirname,
  test: {
    ...base.test,
    include: ['src/features/editor/tests/retention-acceptance-layout.proof.tsx'],
    globalSetup: ['./test/env/retention-acceptance-layout-server.ts'],
    provide: { layoutPeerOrigin: 'http://127.0.0.1:33974' },
    browser: {
      ...base.test?.browser,
      instances: [{ browser: 'chromium', viewport: { width: 1500, height: 1000 } }],
      commands: { ...base.test?.browser?.commands, retentionLayoutArchive },
    },
  },
})

async function retentionLayoutArchive(
  context: BrowserCommandContext,
  payload: string,
  label: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'retention-acceptance-layout-'))
  await writeFile(join(directory, 'raw.json'), payload)
  await context.page.screenshot({ path: join(directory, 'page.png'), fullPage: true })
  await writeFile(
    join(directory, 'receipt.json'),
    JSON.stringify({ label, origin: context.page.url() }),
  )
  return directory
}

declare module 'vitest' {
  interface ProvidedContext {
    layoutPeerOrigin: string
  }
}
