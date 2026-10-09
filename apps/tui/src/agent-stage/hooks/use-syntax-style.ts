import { SyntaxStyle, type StyleDefinitionInput } from '@opentui/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { syntaxKey } from '@/agent-stage/utils/syntax'

export function useSyntaxStyle(styles: Readonly<Record<string, StyleDefinitionInput>>) {
  const key = syntaxKey(styles)
  const [syntax] = useState(() => SyntaxStyle.fromStyles(styles))
  const appliedKey = useRef(key)
  useLayoutEffect(() => {
    if (appliedKey.current === key) return
    for (const [name, style] of Object.entries(styles)) syntax.registerStyle(name, style)
    syntax.clearCache()
    appliedKey.current = key
  }, [key, styles, syntax])
  useEffect(() => () => syntax.destroy(), [syntax])
  return { syntax, key }
}
