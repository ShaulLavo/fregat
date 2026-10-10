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
    name: 'retention-layout',
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
  annotationFailure?: {
    readonly directory: string
    readonly failures: readonly { stage: string; error: string }[]
  },
) {
  const directory =
    annotationFailure?.directory ?? (await mkdtemp(join(tmpdir(), 'retention-acceptance-layout-')))
  const failures: { stage: string; error: unknown }[] = []
  await attemptLayoutArchive(failures, 'raw', () => writeFile(join(directory, 'raw.json'), payload))
  if (failures.length > 0)
    await attemptLayoutArchive(failures, 'raw-fallback', () =>
      writeFile(join(directory, 'raw-fallback.json'), payload),
    )
  if (!annotationFailure)
    await attemptLayoutArchive(failures, 'screenshot', () =>
      context.page.screenshot({ path: join(directory, 'page.png'), fullPage: true }),
    )
  const receipt = () =>
    JSON.stringify({
      label,
      origin: context.page.url(),
      failures: (annotationFailure?.failures ?? []).concat(failures).map((failure) => ({
        stage: failure.stage,
        error: failure.error instanceof Error ? failure.error.message : String(failure.error),
      })),
    })
  await attemptLayoutArchive(failures, 'receipt', () =>
    writeFile(join(directory, 'receipt.json'), receipt()),
  )
  if (failures.some((failure) => failure.stage === 'receipt'))
    await attemptLayoutArchive(failures, 'receipt-fallback', () =>
      writeFile(join(directory, 'receipt-fallback.json'), receipt()),
    )
  if (failures.length > 0) throw failures[0]?.error
  return directory
}

async function attemptLayoutArchive(
  failures: { stage: string; error: unknown }[],
  stage: string,
  action: () => Promise<unknown>,
) {
  try {
    await action()
  } catch (error) {
    failures.push({ stage, error })
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    layoutPeerOrigin: string
  }
}
