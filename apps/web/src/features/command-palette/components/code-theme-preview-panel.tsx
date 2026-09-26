import { Spinner } from '@workspace/ui/components/spinner'
import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import { colorThemeItemValue, scopedPaletteFilter } from '@/features/command-palette/utils/query'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeColorMode, editorThemeOptions } from '@/lib/code-theme/utils/catalog'

export function CodeThemePreviewPanel({ query }: { readonly query: string }) {
  const { selectedThemeId, committedThemeId, colorMode } = useEditorColorTheme()
  const preview = useCodeThemePreview(selectedThemeId)
  const theme = editorThemeOptions(editorThemeColorMode(preview.themeId) ?? colorMode).find(
    (option) => option.id === preview.themeId,
  )
  const matchesSearch =
    theme &&
    scopedPaletteFilter(colorThemeItemValue(theme.id), query, [
      theme.label,
      theme.id,
      theme.type,
      theme.source,
    ]) > 0
  let status = 'Saved theme'
  if (preview.themeId !== committedThemeId) {
    status = matchesSearch ? 'Preview' : 'Last preview'
  }

  return (
    <section
      aria-label='Code theme sample'
      className='max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain'
    >
      <div
        className='text-muted-foreground flex items-center justify-between gap-3 px-3 py-2 text-xs'
        aria-live='polite'
        aria-atomic='true'
        title={theme ? `${theme.id} (${theme.source})` : preview.themeId}
      >
        <span className='text-foreground truncate font-medium'>
          {theme?.label ?? preview.themeId}
        </span>
        <span className='flex shrink-0 items-center gap-(--density-control-gap)'>
          {preview.isFetching && <Spinner label='Loading code theme preview' size='xs' />}
          {status}
        </span>
      </div>
      <CodeThemePreview preview={preview} className='border-0' />
    </section>
  )
}
