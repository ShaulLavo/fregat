import { Editor } from '@singapore-editor/core/editor'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { createTypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'
import { createLineGutterPlugin } from '@singapore-editor/gutters'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import { editorThemeFromVscodeTheme } from '@singapore-editor/core/shiki'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import '@singapore-editor/find/style.css'
import '@singapore-editor/minimap/style.css'

export function mountPlayground(element: HTMLElement): Editor {
  const typescript = createTypeScriptLspPlugin()
  typescript.setWorkspaceFiles([
    { path: '/src/math.ts', text: 'export const twice = (n: number) => n * 2\n' },
  ])
  const editor = new Editor(element, {
    theme: editorThemeFromVscodeTheme({
      colors: { 'editor.background': '#18202b', 'editor.foreground': '#dce5ef' },
    }),
    plugins: [
      createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS),
      createLineGutterPlugin(),
      createEditorFindPlugin(),
      typescript,
      createMinimapPlugin(),
    ],
  })
  editor.openDocument({
    documentId: '/src/main.ts',
    text: "import { twice } from './math'\n\ntwice('two')\n",
    languageId: 'typescript',
  })
  return editor
}
