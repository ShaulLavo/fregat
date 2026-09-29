// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('documents public replacements for each removed diff base color hook', () => {
  const readme = readFileSync(new URL('../../diff/README.md', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../diff/src/style.css', import.meta.url), 'utf8')
  for (const [removed, replacement] of [
    ['--editor-diff-background', 'backgroundColor'],
    ['--editor-diff-foreground', 'foregroundColor'],
    ['--editor-diff-gutter-background', 'gutterBackgroundColor'],
  ]) {
    expect(readme.replace(/ +/g, ' ')).toContain(`| \`${removed}\` | \`${replacement}\` |`)
  }
  expect(css).not.toContain('loses the `--editor-diff-*` block')
})
