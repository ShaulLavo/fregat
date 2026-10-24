import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import type { startProductionCdp } from './production-cdp'
import { withProductionDeadline } from './production-deadline'

type Instrumentation = Awaited<ReturnType<typeof startProductionCdp>>

export async function retainProductionFailure({
  page,
  directory,
  prefix,
  diagnostic,
  instrumentation = null,
}: {
  readonly page: Pick<Page, 'screenshot' | 'content'>
  readonly directory: string
  readonly prefix: 'failure' | 'oracle-failure'
  readonly diagnostic: Readonly<Record<string, unknown>>
  readonly instrumentation?: Instrumentation | null
}) {
  const trace = instrumentation
    ? await bestEffort(
        instrumentation.finishTrace(directory, 'failed'),
        'failure trace finalization',
        20_000,
      )
    : null
  await Promise.allSettled([
    withProductionDeadline(
      writeFile(
        path.join(directory, `${prefix}.json`),
        JSON.stringify({ ...diagnostic, trace }, null, 2) + '\n',
      ),
      'failure record',
      5000,
    ),
    withProductionDeadline(
      page.screenshot({ path: path.join(directory, `${prefix}.png`), timeout: 5000 }),
      'failure screenshot',
      5000,
    ),
    withProductionDeadline(
      page.content().then((html) => writeFile(path.join(directory, `${prefix}.html`), html)),
      'failure HTML',
      5000,
    ),
  ])
}

export async function closeProductionPage(
  page: Pick<Page, 'evaluate'>,
  context: Pick<BrowserContext, 'close'>,
  instrumentation: Instrumentation | null,
  directory: string,
) {
  const cleanup: { operation: string; failure: string | null }[] = []
  try {
    cleanup.push(
      await bestEffort(
        page.evaluate(async () => window.markdownProductionProbe?.dispose()),
        'probe disposal',
        5000,
      ),
    )
    if (instrumentation)
      cleanup.push(await bestEffort(instrumentation.close(), 'instrumentation close', 15_000))
  } finally {
    cleanup.push(await bestEffort(context.close(), 'context close', 5000))
    await bestEffort(
      writeFile(
        path.join(directory, 'capture-cleanup.json'),
        JSON.stringify(cleanup, null, 2) + '\n',
      ),
      'cleanup record',
      5000,
    )
  }
}

async function bestEffort(promise: Promise<unknown>, operation: string, milliseconds: number) {
  try {
    await withProductionDeadline(promise, operation, milliseconds)
    return { operation, failure: null }
  } catch (error) {
    return { operation, failure: error instanceof Error ? error.message : String(error) }
  }
}
