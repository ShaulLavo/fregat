import { test, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packages } from '../scripts/packages'

const script = fileURLToPath(new URL('../scripts/check-samples.ts', import.meta.url))

test('checks only editor package README samples through declaration exports with each framework JSX mode', () => {
  const result = spawnSync('bun', [script, '--packages'], { encoding: 'utf8' })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain(`across ${packages.length} packages.`)
})

async function check(content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'singapore-doc-sample-'))
  try {
    await writeFile(join(directory, 'sample.mdx'), content)
    return spawnSync('bun', [script, directory], { encoding: 'utf8' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('checks fenced samples as separate modules and permits non-code fences', async () => {
  const result = await check(
    [
      '# Example',
      '```ts\nconst answer: number = 42\n```',
      '```typescript\nconst answer: string = "forty-two"\n```',
      '```js\nconst answer = 42\nanswer.toFixed()\n```',
      '```sh\nnpm install @singapore-editor/core\n```',
    ].join('\n\n'),
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain('Checked 3 inline samples and 2 example files')
})

test('rejects a wrong type and identifies its page and fence line', async () => {
  const result = await check('# Example\n\n```ts\nconst answer: number = "wrong"\n```\n')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('sample.mdx:3')
  expect(result.stderr).toContain('TS2322')
})

test('resolves published declaration exports for standalone snippets', async () => {
  const result = await check(
    '```ts\nimport { Editor } from "@singapore-editor/core/editor"\nconst view = new Editor(document.createElement("div"))\nview.dispose()\n```\n',
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
})

test('compiles Solid samples with Solid JSX settings', async () => {
  const result = await check(
    '```tsx\nimport { createSignal } from \'solid-js\'\nconst [count] = createSignal(0)\nexport const view = <button class="counter">{count()}</button>\n```\n',
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
})

test('rejects TypeScript-only syntax in JavaScript fences', async () => {
  const result = await check('```js\nconst answer: number = 42\n```\n')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('sample.mdx:1')
})
