import { EmbeddedTerminalRenderable } from '@opentui/core'
import { extend } from '@opentui/react'

extend({ embeddedTerminal: EmbeddedTerminalRenderable })

declare module '@opentui/react' {
  interface OpenTUIComponents {
    embeddedTerminal: typeof EmbeddedTerminalRenderable
  }
}
