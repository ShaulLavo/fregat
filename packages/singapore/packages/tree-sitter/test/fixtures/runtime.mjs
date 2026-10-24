import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Parser, Language } from 'web-tree-sitter'
import { init, MarkdownDocument, Kind } from 'tree-sitter-md'

const require = createRequire(import.meta.url)
await Parser.init({ locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm') })
const grammar = await Language.load(require.resolve('tree-sitter-md/tree-sitter-markdown.wasm'))
await init({
  grammar,
  resolver: readFileSync(require.resolve('tree-sitter-md/tree-sitter-md.wasm')),
})
const document = new MarkdownDocument()
const text = '**shared runtime**\n'
document.setText(text)
document.reparse()
const records = document.decorations(0, text.length)
assert.ok(records.some((value, index) => index % 4 === 2 && value === Kind.Strong))
document.dispose()
