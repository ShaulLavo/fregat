import { useEffect, useRef, type RefObject } from 'react'
import type { ColorMode, SettingsValues } from '@workspace/contracts'
import { log } from '@/lib/client-logging'

export function useThemeApplicationLog(
  values: SettingsValues,
  mode: ColorMode,
  previewing: boolean,
  duration: RefObject<number>,
) {
  const last = useRef('')
  const theme = values['workbench.theme']
  const signature = JSON.stringify([
    theme?.id,
    theme?.revision,
    mode,
    values['workbench.palette'],
    values['workbench.wallpaper'],
    values['editor.codeTheme.light'],
    values['editor.codeTheme.dark'],
    values['workbench.surface.opacity'],
    values['workbench.surface.contentOpacity'],
    values['workbench.surface.blur'],
    values['workbench.surface.saturation'],
  ])
  useEffect(() => {
    if (!theme || previewing || last.current === signature) return
    last.current = signature
    log.info({
      area: 'appearance',
      action: 'theme.apply',
      themeId: theme.id,
      revision: theme.revision,
      mode,
      paletteId: values['workbench.palette'],
      codeTheme: values[mode === 'light' ? 'editor.codeTheme.light' : 'editor.codeTheme.dark'],
      wallpaper: values['workbench.wallpaper'],
      durationMs: duration.current,
    })
  }, [theme, values, mode, previewing, duration, signature])
}
