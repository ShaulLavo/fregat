import type { ColorMode } from '@workspace/contracts'
import { useEffect, useRef, type KeyboardEvent } from 'react'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useStudioStore } from '@/lib/theme-studio/state/studio-store'
import { DockHeader } from '@/features/theme-studio/components/dock-header'
import { ThemesTab } from '@/features/theme-studio/components/themes-tab'
import { useStudioDraft } from '@/features/theme-studio/hooks/use-studio-draft'
import { useStudioPreview } from '@/features/theme-studio/hooks/use-studio-preview'
import { previewBundle, variantPatch } from '@/features/theme-studio/utils/draft'

/**
 * The theme studio: a strip along the bottom of a workbench that stays live and full size above
 * it. The app shows the draft throughout; only Apply writes, in one request.
 */
export function Dock() {
  const { customizations, draft, dirty } = useStudioDraft()
  const store = useStudioStore()
  const { colorMode } = useEditorColorTheme()
  const bundles = useBundles()
  const mode: ColorMode = store.mode ?? colorMode
  const ref = useRef<HTMLElement>(null)
  useStudioPreview(draft, store.mode)

  // Opening moves focus into the dock once; after that keys belong to whatever holds focus.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-studio-themes]')?.focus()
  }, [])

  function apply() {
    if (!draft || !dirty) return
    bundles.apply(
      draft.theme,
      {
        light: variantPatch(draft.theme.variants.light, draft.variants.light),
        dark: variantPatch(draft.theme.variants.dark, draft.variants.dark),
      },
      previewBundle(draft),
    )
    store.closeStudio()
  }

  function leave() {
    if (dirty && !store.confirmingDiscard) return store.setConfirmingDiscard(true)
    store.closeStudio()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      leave()
      return
    }
    if (event.key !== '\\') return
    event.preventDefault()
    store.setMode(mode === 'dark' ? 'light' : 'dark')
  }

  return (
    <section
      aria-label='Theme studio'
      className='bg-popover-solid flex shrink-0 flex-col'
      data-theme-studio=''
      ref={ref}
      onKeyDown={handleKeyDown}
    >
      <DockHeader
        collapsed={store.collapsed}
        confirmingDiscard={store.confirmingDiscard}
        dirty={dirty}
        mode={mode}
        name={draft?.theme.name ?? 'Theme'}
        tab={store.tab}
        onApply={apply}
        onClose={leave}
        onMode={store.setMode}
        onRevert={store.revert}
        onTab={store.setTab}
        onToggleCollapsed={() => store.setCollapsed(!store.collapsed)}
      />
      {store.collapsed ? null : (
        <div className='h-40 min-h-0'>
          <ThemesTab
            customizations={customizations}
            draft={draft}
            mode={mode}
            onApply={apply}
            onChoose={store.setDraft}
          />
        </div>
      )}
    </section>
  )
}
