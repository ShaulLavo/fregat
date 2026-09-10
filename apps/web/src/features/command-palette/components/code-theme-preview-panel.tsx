import {
  colorThemeItemValue,
  scopedPaletteFilter,
} from '@/features/command-palette/command-palette-utils'
import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'

export function CodeThemePreviewPanel({ query }: { readonly query: string }) {
  const { selectedThemeId, committedThemeId, colorMode } = useEditorColorTheme()
  const theme = editorThemeOptions(colorMode).find((option) => option.id === selectedThemeId)
  const matchesSearch =
    theme &&
    scopedPaletteFilter(colorThemeItemValue(theme.id), query, [
      theme.label,
      theme.id,
      theme.type,
      theme.source,
    ]) > 0
  let status = 'Saved theme'
  if (selectedThemeId !== committedThemeId) {
    status = matchesSearch ? 'Preview' : 'Last preview'
  }

  return (
    <section
      aria-label='Code theme sample'
      className='border-border max-h-[45dvh] shrink-0 overflow-y-auto border-t'
    >
      <div
        className='text-muted-foreground flex items-center justify-between gap-3 px-3 py-2 text-xs'
        aria-live='polite'
        aria-atomic='true'
      >
        <span className='text-foreground truncate font-medium'>
          {theme?.label ?? selectedThemeId}
        </span>
        <span className='shrink-0'>{status}</span>
      </div>
      <CodeThemePreview themeId={selectedThemeId} className='border-0' />
    </section>
  )
}
