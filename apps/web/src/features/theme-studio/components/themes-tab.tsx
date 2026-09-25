import type { ColorMode, ThemeBundle } from '@workspace/contracts'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useRef } from 'react'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import type { StudioDraft } from '@/lib/theme-studio/state/studio-store'
import { ThemeCard } from '@/features/theme-studio/components/theme-card'
import { ThemesToolbar } from '@/features/theme-studio/components/themes-toolbar'
import { savedDraft } from '@/features/theme-studio/utils/draft'
import type { ThemeCustomizations } from '@workspace/contracts'

/**
 * Every theme as a strip of cards. ←→ move and the app repaints as they do; Enter applies.
 * Choosing a card starts the draft over from that theme and its saved changes.
 */
export function ThemesTab({
  customizations,
  draft,
  mode,
  onApply,
  onChoose,
}: {
  customizations: ThemeCustomizations
  draft: StudioDraft | null
  mode: ColorMode
  onApply: () => void
  onChoose: (draft: StudioDraft) => void
}) {
  const { catalog } = useBundles()
  const palettes = usePalette().catalog
  const containerRef = useRef<HTMLDivElement>(null)
  const find = (id: string) => catalog.find((theme) => theme.id === id)
  const choose = (theme: ThemeBundle) => {
    if (theme.id !== draft?.theme.id) onChoose(savedDraft(theme, customizations))
  }
  const list = useListbox({
    role: 'listbox',
    containerRef,
    columns: catalog.length,
    items: catalog.map((theme) => ({ id: theme.id, label: theme.name })),
    activeId: draft?.theme.id ?? null,
    onActiveChange(id) {
      const theme = find(id)
      if (theme) choose(theme)
    },
    onCommit: onApply,
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) =>
      containerRef.current
        ?.querySelectorAll('[role="option"]')
        [index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  })

  return (
    <div className='flex h-full min-w-0 items-center gap-2 pr-(--bar-padding-x)'>
      <div
        {...list.containerProps}
        aria-label='Themes'
        className='focus-ring-inset flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-contain px-(--bar-padding-x) outline-none'
        data-studio-themes=''
      >
        {catalog.map((theme) => {
          const shown =
            theme.id === draft?.theme.id
              ? draft.variants
              : savedDraft(theme, customizations).variants
          const variant = shown[mode]
          return (
            <ThemeCard
              customized={customizations[theme.id] !== undefined}
              key={theme.id}
              mode={mode}
              palette={palettes.find((palette) => palette.id === variant.palette)}
              rowProps={list.rowProps(theme.id)}
              selected={theme.id === draft?.theme.id}
              theme={theme}
              variant={variant}
            />
          )
        })}
      </div>
      <ThemesToolbar />
    </div>
  )
}
