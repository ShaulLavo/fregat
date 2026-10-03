import { presetBinding } from '@/keymap/default-bindings'
import { createClientInvariantError } from '@/lib/structured-errors'

import type { PlatformKeyBinding } from '@/keymap/types'
import { isBindableChord, type PlatformName } from '@workspace/client-core/commands/chord'

type BindingOptions = Partial<Omit<PlatformKeyBinding, 'keys' | 'chord'>> & {
  readonly platform?: PlatformName
}

export function binding(keys: string, options: BindingOptions = {}): PlatformKeyBinding {
  if (!isBindableChord(keys)) {
    throw createClientInvariantError(`Invalid test keybinding: ${keys}`)
  }
  const { platform = 'linux', ...overrides } = options
  return {
    ...presetBinding(
      overrides.entry ?? {
        keys,
        command: 'command' in overrides ? (overrides.command ?? null) : 'workspace.saveFile',
        context: overrides.context ?? 'Workspace',
        source: overrides.source ?? 'default',
      },
      platform,
    ),
    ...overrides,
  }
}
