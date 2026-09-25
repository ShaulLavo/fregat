import { useSettingValue } from '@/hooks/use-setting-value'
import { fontStack } from '@/lib/default-nerd-font'

/** Typography settings as editor options, applied live: the editor measures what it paints. */
export function useEditorTypography() {
  const fontFamily = fontStack(useSettingValue('editor.fontFamily'))
  const fontSize = useSettingValue('editor.fontSize')
  const lineHeight = useSettingValue('editor.lineHeight')
  const tabSize = useSettingValue('editor.tabSize')

  return { fontFamily, fontSize, lineHeight, tabSize }
}
