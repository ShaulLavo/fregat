import { assert, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import {
  Editor,
  type EditorInitialPaintEvent,
  type EditorPlugin,
} from '@singapore-editor/core/editor'
import type { EditorSyntaxCapture } from '@singapore-editor/core/syntax'
import {
  createTreeSitterLanguagePlugin,
  type TreeSitterLanguageContribution,
} from '../../tree-sitter/src/index'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { createMarkdownPreviewPlugin } from '../../markdown/src/index'
import '../src/style.css'
import '../../markdown/src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofMarkdownFenceScreenshot: (hostId: string, row: number, text?: string) => Promise<string>
  }
}

const fences = [
  { language: 'ts', id: 'typescript', text: 'const answer: number = 42' },
  { language: 'js', id: 'javascript', text: 'const answer = "hello"' },
  { language: 'json', id: 'json', text: '{"answer": 42}' },
  { language: 'sh', id: 'shellscript', text: 'echo "hello" # comment' },
] as const

it.for(['plain', 'delayed', 'document', 'decorated', 'wrapped'] as const)(
  'paints injected fence tokens in Markdown live preview with %s text',
  async (path) => {
    let readCaptures: () => readonly EditorSyntaxCapture[] | null = () => null
    const host = document.createElement('div')
    host.id = `markdown-fence-paint-${path}`
    host.style.cssText = 'display:flex;width:600px;height:480px;background:black;color:white'
    document.body.append(host)
    const style = document.createElement('style')
    style.textContent = `#${host.id} .fence-code-row { background: #111111; }`
    document.head.append(style)
    let settleHighlight = (_event: EditorInitialPaintEvent) => {}
    const highlightSettled = new Promise<EditorInitialPaintEvent>((resolve) => {
      settleHighlight = resolve
    })
    const editor = new Editor(host, {
      onInitialPaint: (event) => {
        if (event.phase === 'highlight-settled') settleHighlight(event)
      },
      wordWrap: path === 'wrapped',
      fontSize: 20,
      lineHeight: 28,
      theme: {
        backgroundColor: '#000000',
        foregroundColor: '#ffffff',
        syntax: {
          keywordDeclaration: '#ff0000',
          string: '#ff0000',
          number: '#ff0000',
          function: '#ff0000',
          comment: '#ff0000',
        },
      },
      plugins: [
        createTreeSitterLanguagePlugin(
          path === 'delayed'
            ? TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map(delayMarkdownGrammar)
            : TREE_SITTER_LANGUAGE_CONTRIBUTIONS,
        ),
        createMarkdownPreviewPlugin(),
        captureReaderPlugin((reader) => {
          readCaptures = reader
        }),
      ],
    })
    try {
      const blocks = fences
        .map(({ language, text }) => `\`\`\`${language}\n${text}\n\`\`\`\n`)
        .join('\n')
      const text =
        path === 'wrapped'
          ? '# Heading\n\nA paragraph with **strong text**, inline `code`, and a [link](https://example.com), followed by fenced source.\n\n' +
            blocks
          : blocks
      if (path === 'plain' || path === 'delayed') editor.setText(text, { languageId: 'markdown' })
      else editor.openDocument({ documentId: 'fences.md', text, languageId: 'markdown' })
      editor.setSelection(text.length)
      expect(await highlightSettled).toMatchObject({ status: 'painted' })
      expect(editor.getSyntaxRecords()?.languageId).toBe('markdown')
      await expect.poll(() => host.querySelector('.editor-inline-fence-marker')).toBeTruthy()
      if (path === 'decorated')
        editor.setRowDecorations(
          new Map(
            fences.flatMap((_, index) =>
              [0, 1, 2].map(
                (row) =>
                  [
                    index * 4 + row,
                    { className: 'fence-code-row', snapshotStyle: 'colors' as const },
                  ] as const,
              ),
            ),
          ),
        )
      for (const [index, fence] of fences.entries()) {
        await expect
          .poll(() => readCaptures()?.some((capture) => capture.languageId === fence.id))
          .toBe(true)
        await expect
          .poll(() => redInk(host.id, index * 4 + 1, path === 'wrapped' ? fence.text : undefined), {
            timeout: 5000,
          })
          .toBeGreaterThan(20)
        if (path === 'wrapped') continue
        expect(
          host.querySelector(`[data-editor-virtual-row="${index * 4 + 1}"]`)?.textContent,
        ).toContain(fence.text)
      }
    } finally {
      editor.dispose()
      host.remove()
      style.remove()
    }
  },
)

async function redInk(hostId: string, row: number, text?: string): Promise<number> {
  const screenshot = await commands.proofMarkdownFenceScreenshot(hostId, row, text)
  const bytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  assert(context)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (data[index]! > 150 && data[index + 1]! < 100 && data[index + 2]! < 100) count++
  }
  return count
}

function captureReaderPlugin(
  receive: (reader: () => readonly EditorSyntaxCapture[] | null) => void,
): EditorPlugin {
  return {
    name: 'fence-capture-proof',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          receive(() => view.getSyntaxCaptures())
          const request = view.requestSyntaxCaptures()
          return { update: () => undefined, dispose: () => request.dispose() }
        },
      }),
  }
}

function delayMarkdownGrammar(
  contribution: TreeSitterLanguageContribution,
): TreeSitterLanguageContribution {
  const load = contribution.load
  if (contribution.id !== 'markdown' || !load) return contribution
  return {
    ...contribution,
    async load() {
      // Keep grammar loading beyond expect.poll's default one-second deadline.
      await new Promise<void>((resolve) => setTimeout(resolve, 1200))
      return load()
    },
  }
}
