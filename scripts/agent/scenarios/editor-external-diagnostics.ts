import { match } from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { createScriptError } from '../../structured-errors'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { hoverWord, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const PROBE = 'import { value } from "./dependency";\nexport const count: number = value;\n'
const BROKEN = 'export const value = "wrong";\n'
const FIXED = 'export const value = 1;\n'
const RUNTIMES = [
  // A workspace without its own TypeScript gets the server's, which is the native 7.x.
  { name: 'ts7', typescript: null },
  {
    name: 'ts6',
    typescript: path.resolve(
      import.meta.dirname,
      '../../../apps/server/node_modules/typescript-language-service',
    ),
  },
] as const
const inspections = new WeakMap<Page, { phases: string[] }>()

export const editorExternalDiagnostics: Scenario = {
  name: 'editor-external-diagnostics',
  description:
    'Edit, atomically replace, delete and recreate an unopened dependency outside the app, under TypeScript 7 and 6, and watch the open consumer’s Problems follow.',
  async run(page, { step }) {
    const inspection = { phases: new Array<string>() }
    inspections.set(page, inspection)
    for (const runtime of RUNTIMES) {
      const fixture = await mkdtemp(`/work/tmp/fregat-external-diagnostics-${runtime.name}-`)
      try {
        await writeFixture(fixture, runtime.typescript)
        const dependency = path.join(fixture, 'dependency.ts')
        await openFixtureWorkspace(page, fixture)
        await openFileFromTree(page, 'probe.ts')
        await selectors.bottomTab(page, 'Problems').click()

        await expectProblems(page, /2322|not assignable/)
        await waitForProjectWatch(page, fixture)
        inspection.phases.push(`${runtime.name}:initial-error`)
        await step(`${runtime.name}-initial-error`)

        await writeFile(dependency, FIXED)
        await expectProblems(page, null)
        inspection.phases.push(`${runtime.name}:fixed`)
        await step(`${runtime.name}-fixed`)

        await writeFile(`${dependency}.next`, BROKEN)
        await rename(`${dependency}.next`, dependency)
        await expectProblems(page, /2322|not assignable/)
        inspection.phases.push(`${runtime.name}:atomic-broken`)
        await step(`${runtime.name}-atomic-broken`)

        await rm(dependency)
        await expectProblems(page, /2307|Cannot find module/)
        inspection.phases.push(`${runtime.name}:deleted`)
        await step(`${runtime.name}-deleted`)

        await writeFile(dependency, FIXED)
        await expectProblems(page, null)
        await hoverWord(page, 'value', '.editor-virtualized-viewport')
        match(await selectors.editorHover(page).innerText(), /value: 1/)
        await page.keyboard.press('Escape')
        inspection.phases.push(`${runtime.name}:recreated`)
        await step(`${runtime.name}-recreated`)
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

/**
 * A project watch can queue behind another project's crawl for seconds, and the language server's
 * watches share it: an edit before it attaches is not seen. The tree shows the file once it has.
 */
async function waitForProjectWatch(page: Page, fixture: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const name = `watch-ready-${attempt}.txt`
    await writeFile(path.join(fixture, name), 'ready\n')
    const shown = await selectors
      .treeItem(page, name)
      .waitFor({ timeout: 1000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return
  }
  throw createScriptError('The project watch never attached')
}

async function writeFixture(fixture: string, typescript: string | null) {
  await writeFile(
    path.join(fixture, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ['probe.ts'] }),
  )
  await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}\n')
  await writeFile(path.join(fixture, 'probe.ts'), PROBE)
  await writeFile(path.join(fixture, 'dependency.ts'), BROKEN)
  if (!typescript) return
  await mkdir(path.join(fixture, 'node_modules'))
  await symlink(await realpath(typescript), path.join(fixture, 'node_modules/typescript'), 'dir')
}

/**
 * Waits until the visible problems are exactly one matching `expected`, or none when it is null.
 * A row shows severity and line; its `title` carries the message. None must be an answer from
 * the server, not the absence of one.
 */
async function expectProblems(page: Page, expected: RegExp | null) {
  if (!expected) {
    await waitForProblems(page, null)
    await page.getByText('No problems reported', { exact: true }).waitFor({ timeout: 20_000 })
    return
  }
  await waitForProblems(page, expected)
}

async function waitForProblems(page: Page, expected: RegExp | null) {
  await page.waitForFunction(
    ([source, flags]) => {
      const titles = [
        ...document.querySelectorAll('[role="tree"][aria-label="Problems"] [aria-level="2"]'),
      ].flatMap((row) =>
        row instanceof HTMLElement && row.offsetParent !== null ? [row.title] : [],
      )
      if (source === null) return titles.length === 0
      return titles.length === 1 && new RegExp(source, flags).test(titles[0] ?? '')
    },
    [expected?.source ?? null, expected?.flags ?? ''] as const,
    { timeout: 20_000 },
  )
}
