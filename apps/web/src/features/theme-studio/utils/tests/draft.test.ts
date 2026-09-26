import { BUNDLED_THEMES } from '@workspace/contracts'
import { expect, test } from '../../../../../test/fixtures'

import {
  draftsEqual,
  editVariant,
  previewBundle,
  savedDraft,
  STUDIO_PREVIEW_ID,
  variantPatch,
} from '@/features/theme-studio/utils/draft'

const theme = BUNDLED_THEMES[0]!

test('a saved draft carries the saved changes and previews under its own id', () => {
  const draft = savedDraft(theme, { [theme.id]: { dark: { material: { blur: 3 } } } })
  expect(draft.variants.dark.material.blur).toBe(3)
  expect(draft.variants.light).toEqual(theme.variants.light)
  const preview = previewBundle(draft)
  expect(preview.id).toBe(STUDIO_PREVIEW_ID)
  expect(preview.variants).toBe(draft.variants)
})

test('a patch holds only what changed, and nothing when nothing did', () => {
  const draft = editVariant(savedDraft(theme, {}), 'dark', { material: { opacity: 50 } })
  expect(variantPatch(theme.variants.dark, draft.variants.dark)).toEqual({
    material: { opacity: 50 },
  })
  expect(variantPatch(theme.variants.light, draft.variants.light)).toBeNull()
  expect(draftsEqual(draft, savedDraft(theme, {}))).toBe(false)
  expect(draftsEqual(savedDraft(theme, {}), savedDraft(theme, {}))).toBe(true)
})
