import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, expect, test } from 'vitest'

import { initializeTreeSitterMarkdown, parseTreeSitterMarkdown } from '../tree-sitter-session'

const execute = promisify(execFile)

beforeAll(() => initializeTreeSitterMarkdown())

test('forwards custom CHAT bytes alongside a host-loaded base grammar in a cold realm', async () => {
  const adapter = fileURLToPath(new URL('../tree-sitter-session.ts', import.meta.url))
  const script = [
    "import assert from 'node:assert/strict'",
    "import { readFile } from 'node:fs/promises'",
    "import { createRequire } from 'node:module'",
    "import { Language, Parser } from 'web-tree-sitter'",
    `import { initializeTreeSitterMarkdown, parseTreeSitterMarkdown } from ${JSON.stringify(adapter)}`,
    'const require = createRequire(import.meta.url)',
    "const parser = { locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') }",
    'await Parser.init(parser)',
    "const grammar = await Language.load(await readFile(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm')))",
    "const chatGrammar = await readFile(require.resolve('tree-sitter-md/tree-sitter-markdown-chat.wasm'))",
    "const resolver = await readFile(require.resolve('tree-sitter-md/tree-sitter-md.wasm'))",
    'const options = { parser, grammar, resolver }',
    'await assert.rejects(initializeTreeSitterMarkdown({ ...options, chatGrammar: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]) }))',
    'await initializeTreeSitterMarkdown({ ...options, chatGrammar })',
    "assert.equal(parseTreeSitterMarkdown('$$x\\ny\\n$$', { math: true }).children[0]?.type, 'math')",
    "assert.equal(parseTreeSitterMarkdown('$$x\\ny\\n$$', { math: false }).children[0]?.type, 'paragraph')",
    "process.stdout.write('initialized both grammars')",
  ].join('\n')
  const { stdout } = await execute('bun', ['--eval', script], {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    timeout: 30_000,
  })
  expect(stdout).toBe('initialized both grammars')
}, 45_000)

test.each(['\n', '\r\n', '\r'])('preserves authored flow math metadata with %j', (ending) => {
  const source = ['$$x', 'y', '$$'].join(ending)
  const root = parseTreeSitterMarkdown(source, { math: true })
  expect(root.children).toEqual([
    expect.objectContaining({
      type: 'math',
      value: 'y',
      meta: 'x',
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: source.length, line: 3, column: 3 },
      },
    }),
  ])
})

test('keeps flow math literal when the base profile is selected', () => {
  const source = '$$x\ny\n$$'
  const root = parseTreeSitterMarkdown(source, { math: false })
  expect(root.children).toEqual([expect.objectContaining({ type: 'paragraph' })])
  const text = root.children
    .flatMap((node) => (node.type === 'paragraph' ? node.children : []))
    .map((node) => (node.type === 'text' ? node.value : ''))
    .join('')
  expect(text).toBe(source)
  expect(parseTreeSitterMarkdown(source)).toEqual(root)
})

test('keeps lazy continuation inside the base list paragraph', () => {
  const root = parseTreeSitterMarkdown('- a\nb', { math: false })
  expect(root.children).toEqual([
    expect.objectContaining({
      type: 'list',
      children: [
        expect.objectContaining({
          type: 'listItem',
          children: [
            expect.objectContaining({
              type: 'paragraph',
              position: {
                start: { offset: 2, line: 1, column: 3 },
                end: { offset: 5, line: 2, column: 2 },
              },
            }),
          ],
        }),
      ],
    }),
  ])
})
