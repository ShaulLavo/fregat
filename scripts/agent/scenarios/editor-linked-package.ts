import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { createScriptError } from '../../structured-errors'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const PROBE = 'import { value } from "linked";\nexport const count: number = value;\n'
const inspections = new WeakMap<Page, { phases: string[] }>()

export const editorLinkedPackage: Scenario = {
  name: 'editor-linked-package',
  description:
    'A project whose dependency is linked in from outside it: change, delete and rebuild the package’s declarations, and watch the open consumer’s Problems follow.',
  async run(page, { step }) {
    const inspection = { phases: new Array<string>() }
    inspections.set(page, inspection)
    const fixture = await mkdtemp('/work/tmp/fregat-linked-package-')
    const project = path.join(fixture, 'app')
    const linked = path.join(fixture, 'linked')
    const declarations = path.join(linked, 'dist/index.d.ts')
    try {
      await mkdir(path.join(project, 'node_modules'), { recursive: true })
      await mkdir(path.join(linked, 'dist'), { recursive: true })
      await writeFile(
        path.join(linked, 'package.json'),
        JSON.stringify({ name: 'linked', version: '1.0.0', types: 'dist/index.d.ts' }),
      )
      await writeFile(declarations, 'export declare const value: string\n')
      await symlink('../../linked', path.join(project, 'node_modules/linked'))
      await writeFile(
        path.join(project, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: 'esnext',
            moduleResolution: 'bundler',
          },
          files: ['probe.ts'],
        }),
      )
      await writeFile(path.join(project, 'package.json'), '{"private":true,"type":"module"}\n')
      await writeFile(path.join(project, 'probe.ts'), PROBE)
      await openFixtureWorkspace(page, project)
      await openFileFromTree(page, 'probe.ts')
      await selectors.bottomTab(page, 'Problems').click()

      await expectProblem(page, /2322|not assignable/)
      await step('linked-error')

      await writeFile(declarations, 'export declare const value: number\n')
      await expectNoProblems(page)
      inspection.phases.push('linked-changed')
      await step('linked-changed')

      await rm(path.join(linked, 'dist'), { recursive: true })
      await expectProblem(page, /2307|Cannot find module/)
      inspection.phases.push('linked-removed')
      await step('linked-removed')

      await mkdir(path.join(linked, 'dist'))
      await writeFile(declarations, 'export declare const value: number\n')
      await expectNoProblems(page)
      inspection.phases.push('linked-rebuilt')
      await step('linked-rebuilt')
    } finally {
      await releaseFixture(fixture)
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

async function expectProblem(page: Page, expected: RegExp) {
  await page
    .waitForFunction(
      ([source, flags]) =>
        [
          ...document.querySelectorAll('[role="tree"][aria-label="Problems"] [aria-level="2"]'),
        ].some((row) => row instanceof HTMLElement && new RegExp(source, flags).test(row.title)),
      [expected.source, expected.flags] as const,
      { timeout: 20_000 },
    )
    .catch(() => {
      throw createScriptError(`No problem matching ${expected} appeared`)
    })
}

async function expectNoProblems(page: Page) {
  await page.getByText('No problems reported', { exact: true }).waitFor({ timeout: 20_000 })
}
