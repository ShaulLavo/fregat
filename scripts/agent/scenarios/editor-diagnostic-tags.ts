import { ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { diagnosticTagPaint, focusEditor, openFileFromTree } from '../selectors'
import type { Scenario } from './index'

export async function runDiagnosticTagScenario(
  page: Page,
  context: Parameters<Scenario['run']>[1],
  kind: 'fade' | 'strike',
) {
  const originalUrl = page.url()
  const fixture = await mkdtemp('/work/tmp/fregat-diagnostic-tags-')
  const target = kind === 'fade' ? 'unused' : 'substr'
  try {
    await writeFile(
      path.join(fixture, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true }, include: ['*.ts'] }),
    )
    await writeFile(
      path.join(fixture, 'tags.ts'),
      "export {}\nconst unused = 1\nvoid 'deprecated'.substr(1)\n",
    )
    await openFixtureWorkspace(page, fixture)
    await openFileFromTree(page, 'tags.ts')
    await focusEditor(page)
    let painted: Awaited<ReturnType<typeof diagnosticTagPaint>> = []
    for (let attempt = 0; attempt < 100; attempt++) {
      painted = await diagnosticTagPaint(page, kind)
      if (painted.some((range) => range.text === target)) break
      await page.waitForTimeout(200)
    }
    ok(
      painted.some((range) => range.text === target),
      `${target} has its ${kind} paint`,
    )
    ok(
      painted
        .filter((range) => range.text === target)
        .every((range) => range.color && range.color !== 'currentcolor'),
      'Every overlay carries an explicit text color',
    )
    await context.step(
      kind === 'fade' ? 'unused-faded-in-syntax-color' : 'deprecated-struck-in-syntax-color',
    )
  } finally {
    await page.goto(originalUrl)
    await page.waitForTimeout(1000)
    await releaseFixture(fixture)
  }
}
