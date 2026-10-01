import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { scratchPath } from '../paths'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { focusEditor, hoverWord, openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

const EXAMPLE = ['const first = 1', 'const second = 2', 'const third = 3']
const SOURCE = [
  '/**',
  ' * Doubles a number.',
  ' * @example',
  ' * ```ts',
  ...EXAMPLE.map((line) => ` * ${line}`),
  ' * ```',
  ' */',
  'export function twice(value: number): number {',
  '  return value * 2',
  '}',
  '',
].join('\r\n')
// The server reads `twice.ts` from disk, CRLF and all, because the editor never opens it.
const CALLER = "import { twice } from './twice'\n\nexport const doubled = twice(4)\n"

export const editorLspHoverCrlf: Scenario = {
  name: 'editor-lsp-hover-crlf',
  description:
    'Hover a call into a CRLF TypeScript file the editor never opened, whose doc holds a fenced example of `const` lines. The step label says whether a CR reached the hover code and counts example lines whose `const` is not one whole coloured span.',
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
      const example = selectors
        .editorHover(page)
        .locator('pre > code[data-language]', { hasText: 'const first' })
      await example.locator('span[style]').first().waitFor({ timeout: 8000 })
      const { carriageReturn, painted } = await example.evaluate((code) => ({
        carriageReturn: (code.textContent ?? '').includes('\r'),
        painted: [...code.querySelectorAll('span[style]')].map((span) => span.textContent ?? ''),
      }))
      const whole = painted.filter((text) => text === 'const').length
      await step(`cr-${carriageReturn ? 'yes' : 'no'}-misaligned-${EXAMPLE.length - whole}`)
      await page.keyboard.press('Escape')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
