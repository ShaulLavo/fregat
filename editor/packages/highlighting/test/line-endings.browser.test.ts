import { Editor } from '@singapore-editor/core'
import {
  EDITOR_SNIPPET_TOKENS_FEATURE,
  type EditorSnippetTokensFeature,
} from '@singapore-editor/core/extensions'
import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import type { EditorToken } from '@singapore-editor/core/syntax'
import { bundledThemes } from 'shiki/themes'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createHighlightingPlugin,
  createHighlightingService,
  type HighlightTheme,
  type HighlightingService,
  type HighlightingThemeSelection,
} from '../src/index'

const PALETTE: HighlightTheme = {
  format: 'editor',
  name: 'line-endings-palette',
  definition: {
    type: 'dark',
    backgroundColor: '#111111',
    foregroundColor: '#eeeeee',
    syntax: { keyword: '#aa0000', keywordDeclaration: '#aa0000' },
  },
}

// Each separator kind, a terminated last line and an unterminated one. A CR not before an LF is
// line text, as Shiki splits lines, so `const` after it still starts a statement thanks to `;`.
// A byte order mark and U+2028 are line text too, so no offset moves around them.
const TEXTS = {
  crlf: 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;',
  'crlf terminated': 'const a = 1;\r\nconst b = 2;\r\n',
  'lone cr': 'const a = 1;\rconst b = 2;\r',
  mixed: 'const a = 1;\r\nconst b = 2;\nconst c = 3;\rconst d = 4;\r\n\r\nconst e = 5;',
  'byte order mark and line separator': '\uFEFFconst a = 1;\u2028const b = 2;\r\nconst c = 3;',
} as const

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  document.body.replaceChildren()
})

function service(): HighlightingService {
  const created = createHighlightingService({ resolveTheme: () => githubDark() })
  cleanups.push(() => created.dispose())
  return created
}

async function githubDark(): Promise<VscodeThemeRegistration> {
  const module = await bundledThemes['github-dark']()
  return module.default as unknown as VscodeThemeRegistration
}

/** The snippet feature of a real editor whose syntax comes from the highlighting plugin. */
function snippetTokens(
  highlighting: HighlightingService,
  theme: HighlightingThemeSelection,
): EditorSnippetTokensFeature {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, {
    plugins: [createHighlightingPlugin({ service: highlighting, theme })],
  })
  cleanups.push(() => editor.dispose())
  const feature = editor.getFeature(EDITOR_SNIPPET_TOKENS_FEATURE)
  if (!feature) throw new Error('the editor registered no snippet tokens feature')
  return feature
}

/** For each `const` in the submitted text, the token a painter colours it with, as it slices. */
function paintedConsts(text: string, tokens: readonly Readonly<EditorToken>[]) {
  return [...text.matchAll(/const/g)].map(({ index }) => {
    const token = tokens.find((candidate) => candidate.start <= index && candidate.end > index)
    return token ? [token.start, text.slice(token.start, token.end)] : null
  })
}

function constStarts(text: string) {
  return [...text.matchAll(/const/g)].map(({ index }) => [index, 'const'])
}

describe.each(Object.entries(TEXTS))('%s text', (_name, text) => {
  test('highlight under a built-in palette publishes offsets into the submitted text', async () => {
    const result = await service().highlight(text, { language: 'typescript', theme: PALETTE })
    expect(paintedConsts(text, result.tokens)).toEqual(constStarts(text))
  })

  test('hover snippets under a built-in palette paint the submitted text', async () => {
    const feature = snippetTokens(service(), { format: 'editor' })
    const tokens = await feature.tokenize(text, 'typescript')
    expect(paintedConsts(text, tokens)).toEqual(constStarts(text))
  })

  test('hover snippets under an imported theme match highlight of the same text', async () => {
    const highlighting = service()
    const feature = snippetTokens(highlighting, { format: 'vscode', id: 'github-dark' })
    const [snippet, standalone] = await Promise.all([
      feature.tokenize(text, 'typescript'),
      highlighting.highlight(text, {
        language: 'typescript',
        theme: { format: 'vscode', definition: await githubDark() },
      }),
    ])
    const spans = (tokens: readonly Readonly<EditorToken>[]) =>
      tokens.map((token) => [token.start, text.slice(token.start, token.end), token.style.color])
    expect(paintedConsts(text, snippet)).toEqual(constStarts(text))
    expect(spans(snippet)).toEqual(spans(standalone.tokens))
  })
})
