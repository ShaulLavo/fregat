import { Editor } from '@singapore-editor/core'
import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import type { EditorToken } from '@singapore-editor/core/syntax'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  createTextDiff,
  joinRenderLines,
  type DiffGutterSide,
  type DiffPlugin,
} from '@singapore-editor/diff'
import { bundledThemes } from 'shiki/themes'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createHighlightingService,
  type HighlightingService,
  type HighlightingThemeSelection,
  type HighlightingThemeSource,
} from '../src/index'

// Context, removed and added lines under each separator kind and byte order mark. Git splits lines
// on LF only, so a CRLF line reaches the diff with its CR, and the editor folds what the host pushes.
const DIFFS = {
  crlf: {
    old: 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n',
    new: 'const a = 1;\r\nconst bb = 2;\r\nconst c = 3;\r\nconst d = 4;\r\n',
  },
  mixed: {
    old: 'const a = 1;\r\nconst b = 2;\nconst c = 3;\rconst d = 4;\r\n',
    new: 'const a = 1;\nconst b = 2;\r\nconst c = 3;\rconst d = 44;\r\n',
  },
  'lone cr': {
    old: 'const a = 1;\rconst b = 2;\nconst c = 3;\n',
    new: 'const a = 1;\rconst b = 2;\nconst c = 4;\n',
  },
  'cr before crlf': {
    old: 'const a = 1;\r\r\nconst b = 2;\r\n',
    new: 'const a = 1;\r\r\nconst b = 22;\r\n',
  },
  'two byte order marks': {
    old: '\uFEFF\uFEFFconst a = 1;\r\nconst b = 2;\r\n',
    new: '\uFEFF\uFEFFconst a = 1;\r\nconst b = 22;\r\n',
  },
  'a line inserted before a byte-order-marked first line': {
    old: '\uFEFFconst a = 1;\nconst b = 2;\n',
    new: 'const top = 0;\n\uFEFFconst a = 1;\nconst b = 22;\n',
  },
} as const

const THEMES: Record<string, HighlightingThemeSelection> = {
  'tree-sitter palette': { format: 'editor' },
  'shiki theme': { format: 'vscode', id: 'github-dark' },
}

const SIDES: readonly DiffGutterSide[] = ['stacked', 'old', 'new']

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

function themeSource(selection: HighlightingThemeSelection): HighlightingThemeSource {
  return { current: () => selection, subscribe: () => () => undefined }
}

function diffOf(texts: { readonly old: string; readonly new: string }) {
  return createTextDiff({
    oldFile: { path: 'note.ts', languageId: 'typescript', text: texts.old },
    newFile: { path: 'note.ts', languageId: 'typescript', text: texts.new },
  })
}

/** Pushes the plugin's rows and tokens the way the diff pane does; returns what the editor holds. */
function paint(plugin: DiffPlugin) {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, { ...createDiffEditorOptions(), plugins: [plugin] })
  cleanups.push(() => editor.dispose())
  const tokens = plugin.getTokens()
  editor.setText(joinRenderLines(plugin.getRows()), { tokens })
  return { buffer: editor.getTextSnapshot().materializeFullText(), tokens }
}

/** For each `const` in the editor's text, the token painted over it, as the editor slices it. */
function paintedConsts(buffer: string, tokens: readonly Readonly<EditorToken>[]) {
  return [...buffer.matchAll(/const/g)].map(({ index }) => {
    const token = tokens.find((candidate) => candidate.start <= index && candidate.end > index)
    return token ? [token.start, buffer.slice(token.start, token.end)] : null
  })
}

function constStarts(buffer: string) {
  return [...buffer.matchAll(/const/g)].map(({ index }) => [index, 'const'])
}

describe.each(Object.entries(DIFFS))('%s diff', (_name, texts) => {
  describe.each(Object.entries(THEMES))('under the %s', (_theme, selection) => {
    test.each(SIDES)('a prepared %s pane paints each const whole', async (side) => {
      const highlighting = service()
      const source = themeSource(selection)
      const file = diffOf(texts)
      expect(await highlighting.prepareDiff(file, source)).toBe(true)
      const plugin = createDiffPlugin({
        mode: 'document',
        side,
        syntaxBackend: highlighting.documentBackend(source),
      })
      const shown = highlighting.showDiff(plugin, file, side, source)
      cleanups.push(() => shown.dispose())
      await expect.poll(() => plugin.isSyntaxReady() && plugin.getTokens().length > 0).toBe(true)

      const { buffer, tokens } = paint(plugin)
      expect(paintedConsts(buffer, tokens)).toEqual(constStarts(buffer))
    })

    test.each(SIDES)('a %s pane parsed on display paints each const whole', async (side) => {
      const highlighting = service()
      const plugin = createDiffPlugin({
        mode: 'document',
        side,
        syntaxBackend: highlighting.documentBackend(themeSource(selection)),
      })
      plugin.setFile(diffOf(texts))
      cleanups.push(() => plugin.setFile(null))
      await expect.poll(() => plugin.isSyntaxReady() && plugin.getTokens().length > 0).toBe(true)

      const { buffer, tokens } = paint(plugin)
      expect(paintedConsts(buffer, tokens)).toEqual(constStarts(buffer))
    })
  })
})
