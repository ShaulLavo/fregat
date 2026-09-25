import { act } from '@testing-library/react'
import { afterEach } from 'vitest'
import { BUNDLED_THEMES, bundledPalette, paletteColorsFor } from '@workspace/contracts'
import { useDraftPalette } from '@/features/theme-studio/hooks/use-draft-palette'
import { editVariant, savedDraft } from '@/features/theme-studio/utils/draft'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'

afterEach(() => useStudioStore.getState().closeStudio())

test('a delayed color edit updates the current mode without replacing newer surface edits', () => {
  useStudioStore.getState().openStudio()
  const initial = savedDraft(BUNDLED_THEMES[0]!, {})
  useStudioStore.getState().setDraft(initial)
  const hook = renderHookWithProviders(() => {
    const state = useStudioStore()
    return useDraftPalette(state.draft, state.mode ?? 'dark')
  })
  const delayedSetColors = hook.result.current.setColors
  act(() => {
    useStudioStore.getState().setDraft(editVariant(initial, 'dark', { material: { opacity: 23 } }))
    useStudioStore.getState().setMode('light')
  })

  act(() => delayedSetColors(paletteColorsFor(bundledPalette('sage')!, 'light')))

  const current = useStudioStore.getState()
  expect(current.draft?.variants.dark.material.opacity).toBe(23)
  expect(current.paletteEdits.light).toBeDefined()
  expect(current.paletteEdits.dark).toBeUndefined()
})

test('a delayed color edit cannot change a studio reopened after discard', () => {
  useStudioStore.getState().openStudio()
  const initial = savedDraft(BUNDLED_THEMES[0]!, {})
  useStudioStore.getState().setDraft(initial)
  const hook = renderHookWithProviders(() =>
    useDraftPalette(
      useStudioStore((state) => state.draft),
      'dark',
    ),
  )
  const delayedSetColors = hook.result.current.setColors
  act(() => {
    useStudioStore.getState().closeStudio()
    useStudioStore.getState().openStudio()
  })

  act(() => delayedSetColors(paletteColorsFor(bundledPalette('sage')!, 'dark')))

  expect(useStudioStore.getState().draft).toBeNull()
  expect(useStudioStore.getState().paletteEdits).toEqual({})
})
