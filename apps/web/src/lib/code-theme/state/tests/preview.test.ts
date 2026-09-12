import { expect, test } from '../../../../../test/fixtures'
import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'
import { CODE_THEME_PREVIEW_SAMPLE } from '@/lib/code-theme/utils/preview'
import { vi } from 'vitest'

test('native and imported previews parse the same sample with their actual syntax colors', async () => {
  const [native, imported] = await Promise.all([
    loadCodeThemePreview('tree-sitter-dark'),
    loadCodeThemePreview('dracula'),
  ])

  for (const preview of [native, imported]) {
    expect(
      preview.tokens.map((line) => line.map((token) => token.content).join('')).join('\n'),
    ).toBe(CODE_THEME_PREVIEW_SAMPLE)
    expect(preview.tokens).toHaveLength(9)
    expect(
      new Set(preview.tokens.flatMap((line) => line.map((token) => token.color))).size,
    ).toBeGreaterThan(4)
  }
  expect(native.tokens[0]?.find((token) => token.content.includes('Format'))?.color).toBe('#71717A')
  expect(imported.tokens[0]?.[0]?.color).not.toBe(native.tokens[0]?.[0]?.color)
})

test('an unavailable preview rejects instead of displaying a different theme', async () => {
  await expect(loadCodeThemePreview('missing-preview-theme')).rejects.toMatchObject({
    data: { code: 'UNKNOWN_CODE_THEME' },
  })
})

test('preview syntax colors survive a slow tokenizer clock', async () => {
  let clock = Date.now()
  const now = vi.spyOn(Date, 'now').mockImplementation(() => {
    clock += 600
    return clock
  })
  try {
    const preview = await loadCodeThemePreview('tree-sitter-light')
    expect(preview.tokens[0]?.find((token) => token.content.includes('Format'))?.color).toBe(
      '#6E7781',
    )
    expect(
      new Set(preview.tokens.flatMap((line) => line.map((token) => token.color))).size,
    ).toBeGreaterThan(4)
  } finally {
    now.mockRestore()
  }
})
