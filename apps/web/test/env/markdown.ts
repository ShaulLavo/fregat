import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { initializeTreeSitterMarkdown } from '@workspace/markdown/utils/tree-sitter-session'

const require = createRequire(import.meta.url)
const markdownRequire = createRequire(
  require.resolve('@workspace/markdown/utils/tree-sitter-runtime'),
)

// Happy DOM's SSR imports produce /@fs URLs without a Vite HTTP asset server.
export async function initializeDomMarkdown(): Promise<void> {
  const [parser, grammar, chatGrammar, resolver] = await Promise.all([
    readFile(markdownRequire.resolve('web-tree-sitter/web-tree-sitter.wasm')),
    readFile(markdownRequire.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
    readFile(markdownRequire.resolve('tree-sitter-md/tree-sitter-markdown-chat.wasm')),
    readFile(markdownRequire.resolve('tree-sitter-md/tree-sitter-md.wasm')),
  ])
  await initializeTreeSitterMarkdown({
    parser: { wasmBinary: parser },
    grammar,
    chatGrammar,
    resolver,
  })
}
