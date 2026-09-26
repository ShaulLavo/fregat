import { useSettingValue } from '@/hooks/use-setting-value'
import { useMarkdownViewOverrides } from '@/lib/markdown-mode/state/overrides'
import type { MarkdownView } from '@/lib/markdown-mode/utils/mode'

/** How this markdown document shows: its own pick, else the setting. */
export function useMarkdownView(documentKey: string | null): MarkdownView {
  const setting = useSettingValue('editor.markdownView')
  const override = useMarkdownViewOverrides((state) =>
    documentKey ? state.views[documentKey] : undefined,
  )
  return override ?? setting
}
