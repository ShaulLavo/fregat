import { test, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../scripts/check-samples.ts', import.meta.url))

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
  expect(result.stdout).toContain('Checked 3 inline samples and 4 example files')
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

test('rejects TypeScript-only syntax in JavaScript fences', async () => {
  const result = await check('```js\nconst answer: number = 42\n```\n')
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('sample.mdx:1')
})
