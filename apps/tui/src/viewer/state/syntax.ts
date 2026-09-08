import { createIncrementalTokenizer } from '@singapor/core/shiki'
import { createBundledHighlighter } from 'shiki/core'
import { bundledLanguages } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { languageForPath } from '@/viewer/utils/language'

export function createViewerSyntax() {
  const createHighlighter = createBundledHighlighter<string, string>({
    langs: bundledLanguages,
    themes: bundledThemes,
    engine: () => createOnigurumaEngine(import('shiki/wasm')),
  })
  const highlighter = createHighlighter({ themes: ['dark-plus', 'light-plus'], langs: [] })
  let disposed = false
  return {
    async tokenize(path: string, content: string, appearance: 'dark' | 'light') {
      const engine = await highlighter
      const language = languageForPath(path)
      const registration = Object.entries(bundledLanguages).find(([name]) => name === language)?.[1]
      if (!registration || disposed) return content.split('\n').map((text) => [{ content: text }])
      await engine.loadLanguage(registration)
      if (disposed) return []
      const { tokenizer } = await createIncrementalTokenizer({
        highlighter: engine,
        code: content,
        lang: language,
        theme: `${appearance}-plus`,
      })
      return tokenizer.getTokens()
    },
    dispose() {
      disposed = true
      void highlighter.then((engine) => engine.dispose())
    },
  }
}

export type ViewerTokens = Awaited<ReturnType<ReturnType<typeof createViewerSyntax>['tokenize']>>
