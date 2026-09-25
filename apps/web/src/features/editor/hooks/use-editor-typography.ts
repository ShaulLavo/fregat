import { useSettingValue } from '@/hooks/use-setting-value'
import { fontStack } from '@/lib/fonts/utils/stack'

/** Typography settings as editor options, applied live: the editor measures what it paints. */
export function useEditorTypography() {
  const fontFamily = fontStack(useSettingValue('editor.fontFamily'), 'code')
  const fontSize = useSettingValue('editor.fontSize')
  const lineHeight = useSettingValue('editor.lineHeight')
  const tabSize = useSettingValue('editor.tabSize')

  return { fontFamily, fontSize, lineHeight, tabSize }
}
