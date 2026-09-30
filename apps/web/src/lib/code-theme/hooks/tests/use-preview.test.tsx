import { renderHook, waitFor } from '@testing-library/react'

import { expect, test } from '../../../../../test/fixtures'
import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'

test('changing the theme during a pending highlight keeps the latest preview', async () => {
  await loadCodeThemePreview('monokai')
  const hook = renderHook(({ themeId }) => useCodeThemePreview(themeId), {
    initialProps: { themeId: 'github-light' },
  })
  expect(hook.result.current).toMatchObject({ kind: 'loading', themeId: 'github-light' })
  hook.rerender({ themeId: 'monokai' })

  await waitFor(() =>
    expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'monokai' }),
  )
  await loadCodeThemePreview('github-light')
  expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'monokai' })
})

test('a cold theme keeps the loaded subject and tokens until both can swap', async () => {
  const result = await loadCodeThemePreview('dracula')
  const hook = renderHook(({ themeId }) => useCodeThemePreview(themeId), {
    initialProps: { themeId: 'dracula' },
  })
  hook.rerender({ themeId: 'nord' })
  expect(hook.result.current).toMatchObject({
    kind: 'ready',
    themeId: 'dracula',
    isFetching: true,
  })
  expect(hook.result.current.kind === 'ready' && hook.result.current.result).toBe(result)
  await waitFor(() =>
    expect(hook.result.current).toMatchObject({
      kind: 'ready',
      themeId: 'nord',
      isFetching: false,
    }),
  )
})

test('a failed replacement shows its own error and a later theme recovers', async () => {
  await loadCodeThemePreview('github-dark')
  const hook = renderHook(({ themeId }) => useCodeThemePreview(themeId), {
    initialProps: { themeId: 'github-dark' },
  })
  hook.rerender({ themeId: 'missing-preview-theme' })
  expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'github-dark' })
  await waitFor(() =>
    expect(hook.result.current).toMatchObject({ kind: 'error', themeId: 'missing-preview-theme' }),
  )
  hook.rerender({ themeId: 'github-dark' })
  expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'github-dark' })
})

test('returning to a cached theme ignores the superseded highlight completion', async () => {
  await loadCodeThemePreview('solarized-dark')
  const hook = renderHook(({ themeId }) => useCodeThemePreview(themeId), {
    initialProps: { themeId: 'solarized-dark' },
  })
  hook.rerender({ themeId: 'rose-pine' })
  expect(hook.result.current).toMatchObject({
    kind: 'ready',
    themeId: 'solarized-dark',
    isFetching: true,
  })
  hook.rerender({ themeId: 'solarized-dark' })
  expect(hook.result.current).toMatchObject({
    kind: 'ready',
    themeId: 'solarized-dark',
    isFetching: false,
  })
  await loadCodeThemePreview('rose-pine')
  expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'solarized-dark' })
})
