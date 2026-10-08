import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import grammar from 'tree-sitter-typescript/tree-sitter-typescript.wasm?url'
import tsHighlights from '../../../packages/tree-sitter-languages/src/queries/typescript-highlights.scm?raw'
import jsHighlights from '../../../packages/tree-sitter-languages/src/queries/javascript-highlights.scm?raw'
import tsFolds from '../../../packages/tree-sitter-languages/src/queries/typescript-folds.scm?raw'
import jsFolds from '../../../packages/tree-sitter-languages/src/queries/javascript-folds.scm?raw'

export function createTypeScriptHighlighting() {
  return createTreeSitterLanguagePlugin([
    {
      id: 'typescript',
      extensions: ['.ts', '.cts', '.mts'],
      aliases: ['ts'],
      wasmUrl: grammar,
      highlightQuerySource: [tsHighlights, jsHighlights].join('\n'),
      foldQuerySource: [tsFolds, jsFolds].join('\n'),
    },
  ])
}
