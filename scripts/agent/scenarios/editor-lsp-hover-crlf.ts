import { strictEqual } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { scratchPath } from '../paths'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, hoverCodePaint, hoverWord, openFileByName } from '../selectors'
import type { Scenario } from './index'

const EXAMPLE = ['const first = 1', 'const second = 2', 'const third = 3']
const SOURCE = ['/**', ' * Doubles a number.', ' * @example', ' * ```ts']
  .concat(
    EXAMPLE.map((line) => ` * ${line}`),
    [
      ' * ```',
      ' */',
      'export function twice(value: number): number {',
      '  return value * 2',
      '}',
      '',
    ],
  )
  .join('\r\n')
// The server reads `twice.ts` from disk, CRLF and all, because the editor never opens it.
const CALLER = "import { twice } from './twice'\n\nexport const doubled = twice(4)\n"

export const editorLspHoverCrlf: Scenario = {
  name: 'editor-lsp-hover-crlf',
  description:
    'Hover a call into a CRLF TypeScript file the editor never opened, whose doc holds a fenced example of `const` lines. Fails unless a CR reaches the hover code and each example `const` is one whole coloured span; the step label records both.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp(scratchPath('fregat-hover-crlf-'))
    try {
      await writeFile(path.join(fixture, 'twice.ts'), SOURCE)
      await writeFile(path.join(fixture, 'caller.ts'), CALLER)
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
      )
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'caller.ts')
      await focusEditor(page)
      await page.waitForTimeout(3000)
      await hoverWord(page, 'twice', '.editor-virtualized-viewport')
      const { carriageReturn, coloured } = await hoverCodePaint(page, 'const first')
      const whole = coloured.filter((text) => text === 'const').length
      await step(`cr-${carriageReturn ? 'yes' : 'no'}-misaligned-${EXAMPLE.length - whole}`)
      strictEqual(carriageReturn, true, 'a CR reaches the hover code, so the CRLF case reproduces')
      strictEqual(whole, EXAMPLE.length, 'each example `const` is one whole coloured span')
      await page.keyboard.press('Escape')
    } finally {
      // Navigating back can fail once the page is gone; the fixture's terminal and LSP still go.
      try {
        await page.goto(originalUrl)
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
}
