import { createRoot, type Root } from 'react-dom/client'
import { detectPlatform } from '@fregat/hotkeys'
import type { KeybindingPreset } from '@workspace/client-core/commands/metadata'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { createTestQueryClient } from '../render'
import { FocusProvider } from '@/lib/focus/providers/provider'
import { TestCommandProvider } from './command-runtime'

export function createTreeTestRoot(
  container: HTMLElement,
  preset: KeybindingPreset = 'ours',
): Root {
  const root = createRoot(container)
  const queryClient = createTestQueryClient()
  return {
    render(children) {
      root.render(
        <FocusProvider>
          <TestCommandProvider
            options={{ bindings: defaultPlatformKeyBindings(detectPlatform(), preset) }}
            queryClient={queryClient}
          >
            {children}
          </TestCommandProvider>
        </FocusProvider>,
      )
    },
    unmount() {
      root.unmount()
      queryClient.clear()
    },
  }
}
