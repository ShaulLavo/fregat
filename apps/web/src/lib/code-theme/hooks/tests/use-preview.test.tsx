import { renderHook, waitFor } from '@testing-library/react'

import { expect, test } from '../../../../../test/fixtures'
import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'

test('changing the theme during a pending highlight keeps the latest preview', async () => {
  await loadCodeThemePreview('monokai')
  const hook = renderHook(({ themeId }) => useCodeThemePreview(themeId), {
    initialProps: { themeId: 'tree-sitter-light' },
  })
  hook.rerender({ themeId: 'monokai' })

  await waitFor(() =>
    expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'monokai' }),
  )
  await loadCodeThemePreview('tree-sitter-light')
  expect(hook.result.current).toMatchObject({ kind: 'ready', themeId: 'monokai' })
})
