import { useSettingValue } from '@/hooks/use-setting-value'
import { fontStack } from '@/lib/default-nerd-font'

/** Typography settings as editor options: the editor measures the face it paints with. */
export function useEditorTypography() {
  const fontFamily = fontStack(useSettingValue('editor.fontFamily'))
  const fontSize = useSettingValue('editor.fontSize')
  const lineHeight = useSettingValue('editor.lineHeight')

  return { fontFamily, fontSize, lineHeight }
}
