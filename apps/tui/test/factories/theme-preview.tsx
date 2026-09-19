import { useTheme } from '@/theme/hooks/use-theme'

export function ThemePreview({
  mode = 'system',
  noColor = false,
  hostColors = false,
}: {
  mode?: 'light' | 'dark' | 'system'
  noColor?: boolean
  hostColors?: boolean
}) {
  const theme = useTheme(mode, noColor, { hostColors })
  return (
    <box backgroundColor={theme.background}>
      <text fg={theme.foreground}>Theme sample</text>
    </box>
  )
}
