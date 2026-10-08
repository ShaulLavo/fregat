import { Editor } from '@singapore-editor/core/editor'
import { createMarkdownPreviewPlugin } from '@singapore-editor/markdown'
import { markdown } from '../../tree-sitter-languages/dist/index.js'
import '../../editor/src/style.css'
import '../src/style.css'

const text =
  Array.from(
    { length: 9 },
    (_, index) =>
      `${'#'.repeat((index % 6) + 1)} Section ${index + 1}\nRead [link ${index + 1}](https://example.com/${index + 1}).`,
  ).join('\n') + '\nEnd of document.'
const article = document.createElement('article')
for (let index = 0; index < 9; index++) {
  const heading = document.createElement(`h${(index % 6) + 1}`)
  heading.textContent = `Section ${index + 1}`
  const link = document.createElement('a')
  link.href = `https://example.com/${index + 1}`
  link.textContent = `link ${index + 1}`
  article.append(heading, link)
}
document.body.append(article)
const container = document.createElement('main')
container.style.cssText = 'height:540px;width:960px;font:14px/20px monospace'
document.body.append(container)
const editor = new Editor(container, { plugins: [markdown(), createMarkdownPreviewPlugin()] })

const proof = {
  takeover() {
    editor.setText(text, { languageId: 'markdown' })
    editor.setSelection(text.length)
    article.hidden = true
  },
  loadMarkdown(source: string, wrap: boolean) {
    editor.setText(source, { languageId: 'markdown' })
    editor.setSelection(source.length)
    editor.setWordWrap(wrap)
    editor.setScrollPosition({ top: 0 })
  },
  loadPlain(source: string) {
    editor.setWordWrap(false)
    editor.setText(source, { languageId: 'plaintext' })
  },
  scroll(top: number) {
    editor.setScrollPosition({ top })
  },
  async frames(count: number) {
    performance.mark('reading-scroll-start')
    for (let frame = 0; frame <= count; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      performance.mark('reading-scroll-frame')
      editor.setScrollPosition({ top: frame * 200 })
    }
    performance.mark('reading-scroll-end')
  },
}
declare global {
  interface Window {
    readingProof: typeof proof
  }
}
window.readingProof = proof
