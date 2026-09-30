import { expect, test } from '../../../../../test/fixtures'
import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'
import { highlightLines } from '@singapore-editor/highlighting'
import { CODE_THEME_PREVIEW_SAMPLE } from '@/lib/code-theme/utils/preview'
import type { HighlightResult } from '@singapore-editor/highlighting'

function lines(preview: HighlightResult) {
  return highlightLines(CODE_THEME_PREVIEW_SAMPLE, preview.tokens)
}

function colorOf(preview: HighlightResult, word: string) {
  const start = CODE_THEME_PREVIEW_SAMPLE.indexOf(word)
  return preview.tokens.find((token) => token.start <= start && token.end > start)?.style.color
}

test('native and imported previews parse the same sample in the worker with their own colors', async () => {
  const [native, imported] = await Promise.all([
    loadCodeThemePreview('tree-sitter-dark'),
    loadCodeThemePreview('dracula'),
  ])

  for (const preview of [native, imported]) {
    expect(
      lines(preview)
        .map((line) => line.map((segment) => segment.text).join(''))
        .join('\n'),
    ).toBe(CODE_THEME_PREVIEW_SAMPLE)
    expect(lines(preview)).toHaveLength(9)
    expect(new Set(preview.tokens.map((token) => token.style.color)).size).toBeGreaterThan(4)
  }
  expect(colorOf(native, 'Format')).toBe('#71717A')
  expect(colorOf(imported, 'Format')).not.toBe(colorOf(native, 'Format'))
  expect(native.themeRevision).not.toBe(imported.themeRevision)
})

test('a light built-in palette keeps its own comment color', async () => {
  const preview = await loadCodeThemePreview('tree-sitter-light')
  expect(colorOf(preview, 'Format')).toBe('#6E7781')
})

test('an unavailable preview rejects instead of displaying a different theme', async () => {
  await expect(loadCodeThemePreview('missing-preview-theme')).rejects.toMatchObject({
    data: { code: 'UNKNOWN_CODE_THEME' },
  })
})
