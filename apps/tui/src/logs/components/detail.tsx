import { useEffect, useState } from 'react'
import type { SyntaxStyle } from '@opentui/core'
import { loadVscodeThemeRegistration } from '@workspace/client-core/themes/registration'
import { createSyntaxStyle } from '@/theme/utils/syntax'
import { LoadingState } from '@/components/loading-state'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'

export function LogDetail({
  value,
  theme,
  enabled,
}: {
  value: Readonly<Record<string, unknown>>
  theme: Theme
  enabled: boolean
}) {
  const { appearance, colorMode, terminalColors } = theme
  const [style, setStyle] = useState<SyntaxStyle | null>(null)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let active = true
    let owned: SyntaxStyle | null = null
    void loadVscodeThemeRegistration(`${appearance}-plus`)
      .then((registration) => {
        if (!active) return
        owned = createSyntaxStyle(registration, { colorMode, terminalColors })
        setStyle(owned)
      })
      .catch((error) => {
        if (active) setFailure(connectionFailure(error).message)
      })
    return () => {
      active = false
      owned?.destroy()
    }
  }, [appearance, colorMode, terminalColors])
  if (failure) return <text fg={theme.destructive}>{failure}</text>
  if (!style) return <LoadingState theme={theme} label='Preparing log event…' />
  return (
    <scrollbox id='logs-json' focused={enabled} flexGrow={1} minHeight={0}>
      <code
        content={JSON.stringify(value, null, 2)}
        filetype='json'
        syntaxStyle={style}
        fg={theme.foreground}
      />
    </scrollbox>
  )
}
