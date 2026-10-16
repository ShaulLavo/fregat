import { expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
// Package exports exercise the built distribution and its emitted worker.
import {
  TreeSitterWorkerOwner,
  createTreeSitterSyntaxProvider,
  createTreeSitterSyntaxPlugin,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/dist/index.js'

function hasPaintedSyntax(host: HTMLElement): boolean {
  return Array.from(CSS.highlights.values()).some((group) =>
    Array.from(group).some((range) => host.contains(range.startContainer) && range.toString()),
  )
}

async function hasCurrentSource(
  owner: TreeSitterWorkerOwner,
  languageId: string,
  sourceUnits: number,
): Promise<boolean> {
  const retention = await owner.inspectRetention()
  return (
    retention?.documents.some((document) =>
      document.snapshots.some(
        (snapshot) =>
          snapshot.languageId === languageId &&
          snapshot.sourceUnits === sourceUnits &&
          (snapshot.treeCount > 0 || snapshot.markdownDocumentCount > 0),
      ),
    ) ?? false
  )
}

it.each([
  { languageId: 'typescript', text: 'const value = 1;\n' },
  { languageId: 'markdown', text: '# שלום 🪐\n\nA **bold** [link](/x).\n' },
])(
  'executes the built $languageId worker through the simple Editor API',
  async ({ languageId, text }) => {
    const host = document.createElement('div')
    const owner = new TreeSitterWorkerOwner()
    let editor: Editor | undefined
    try {
      host.style.height = '300px'
      host.style.width = '700px'
      document.body.append(host)
      const provider = createTreeSitterSyntaxProvider({ workerOwner: owner })
      for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
        provider.registerLanguage(contribution)
      editor = new Editor(host, { plugins: [createTreeSitterSyntaxPlugin(provider)] })
      editor.setText(text, { languageId })
      await expect
        .poll(
          async () =>
            (await hasCurrentSource(owner, languageId, text.length)) && hasPaintedSyntax(host),
          { timeout: 4000 },
        )
        .toBe(true)
      const edited = '// 漢字 🦀\n' + text
      editor.setText(edited, { languageId })
      await expect
        .poll(
          async () =>
            (await hasCurrentSource(owner, languageId, edited.length)) &&
            host.textContent?.includes('漢字') === true &&
            hasPaintedSyntax(host),
          { timeout: 4000 },
        )
        .toBe(true)
    } finally {
      editor?.dispose()
      await owner.dispose()
      host.remove()
    }
  },
)
