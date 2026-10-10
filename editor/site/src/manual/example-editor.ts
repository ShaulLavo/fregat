import { Editor } from '@singapore-editor/core/editor'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { createLineGutterPlugin } from '@singapore-editor/gutters'
import { fenceLanguage, languageContribution } from './languages'
import { paletteTheme } from './theme'

export type ExampleEditor = ReturnType<typeof mountExample>
export function mountExample(
  host: HTMLElement,
  options: {
    text: string
    language: string
    label: string
    snapshot?: string
    fallbackFont?: boolean
  },
) {
  const language = fenceLanguage(options.language)
  if (language === null) throw new TypeError(`No Singapore grammar for ${options.language}`)
  const element = document.createElement('div')
  element.className = 'sg-example-editor'
  host.append(element)
  const editor = new Editor(element, {
    presentationReady: false,
    scrollMode: 'content',
    wordWrap: true,
    wordWrapBreak: 'word',
    fontFamily: options.fallbackFont ? '"Singapore Mono Fallback", monospace' : '"JetBrains Mono"',
    fontSize: 14,
    lineHeight: 22,
    tabSize: 2,
    snapshot: options.snapshot,
    theme: paletteTheme(host, 'code-bg'),
    gutterScroll: 'content',
    plugins: [createLineGutterPlugin({ minWidth: 36 })].concat(
      language === 'text' ? [] : [createTreeSitterLanguagePlugin([languageContribution(language)])],
    ),
  })
  element.setAttribute('aria-label', options.label)
  element.querySelector('textarea')?.setAttribute('aria-label', options.label)
  editor.setTabMovesFocus(true)
  editor.openDocument({ documentId: 'example', text: options.text, languageId: language })
  let disposed = false
  return {
    editor,
    element,
    async ready() {
      const started = performance.now()
      editor.setPresentationReady(true)
      while (editor.captureSnapshot({ scope: 'document' }).status !== 'ready') {
        if (performance.now() - started > 15000)
          throw new TypeError(`Example paint did not become ready for ${language}`)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    },
    refreshTheme() {
      editor.setTheme(paletteTheme(host, 'code-bg'))
    },
    dispose() {
      if (disposed) return
      disposed = true
      editor.dispose()
      element.remove()
    },
  }
}
