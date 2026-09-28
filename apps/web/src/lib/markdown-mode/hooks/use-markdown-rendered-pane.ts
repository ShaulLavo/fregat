import { useSettingValue } from '@/hooks/use-setting-value'
import { useMarkdownViewOverrides } from '@/lib/markdown-mode/state/overrides'

export function useMarkdownRenderedPane(documentKey: string | null): boolean {
  const setting = useSettingValue('editor.markdownRenderedPane')
  const override = useMarkdownViewOverrides((state) =>
    documentKey ? state.renderedPanes[documentKey] : undefined,
  )
  return override ?? setting
}
