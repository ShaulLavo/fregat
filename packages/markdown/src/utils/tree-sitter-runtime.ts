import parser from 'web-tree-sitter/web-tree-sitter.wasm?url'
import grammar from 'tree-sitter-md/tree-sitter-markdown.wasm?url'
import chatGrammar from 'tree-sitter-md/tree-sitter-markdown-chat.wasm?url'
import resolver from 'tree-sitter-md/tree-sitter-md.wasm?url'

export { memoryBytes } from 'tree-sitter-md'

export const treeSitterMarkdownAssets = { parser, grammar, chatGrammar, resolver }
