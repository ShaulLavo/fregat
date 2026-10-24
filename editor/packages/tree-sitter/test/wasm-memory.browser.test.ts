import { expect, it } from 'vitest'
import { Language, Parser } from 'web-tree-sitter'
import parserWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import grammarUrl from 'tree-sitter-md/tree-sitter-markdown.wasm?url'
import chatGrammarUrl from 'tree-sitter-md/tree-sitter-markdown-chat.wasm?url'
import resolverUrl from 'tree-sitter-md/tree-sitter-md.wasm?url'
import { init } from 'tree-sitter-md'
import { verifySharedHeapGrowth } from './fixtures/wasm-memory'

it('keeps retained heap views and Unicode Markdown results valid after allocator growth', async () => {
  await Parser.init({ locateFile: () => parserWasmUrl })
  const grammar = await Language.load(grammarUrl)
  const [response, chatResponse] = await Promise.all([fetch(resolverUrl), fetch(chatGrammarUrl)])
  expect(response.ok).toBe(true)
  expect(chatResponse.ok).toBe(true)
  await init({
    grammar,
    chatGrammar: await chatResponse.arrayBuffer(),
    resolver: await response.arrayBuffer(),
  })
  verifySharedHeapGrowth()
})
