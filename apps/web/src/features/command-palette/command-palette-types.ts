import type { TabContent } from '@/lib/documents/utils/types'
import type { QuickAccessMode } from '@workspace/client-core/commands/palette'
import type { Theme } from '@/features/settings/providers/theme-context'
import type { TreeEntry } from '@/lib/file-system-types'
import type { PlatformCommandId } from '@/keymap/types'

export type CommandPaletteSelection = {
  readonly command: PlatformCommandId
  readonly kind: 'platform'
}

export type CommandPaletteItem = {
  readonly aliases: readonly string[]
  readonly category: string
  readonly command: CommandPaletteSelection
  readonly description?: string
  readonly disabledReason?: string | null
  readonly id: string
  readonly keywords: string[]
  readonly shortcut: string | null
  readonly title: string
}

export type FilePaletteItem = {
  readonly entry: TreeEntry
  readonly pathLabel: string
}

export type ViewPaletteItem = {
  readonly command: PlatformCommandId
  readonly description: string
  readonly title: string
  readonly value: string
}

export type ColorModePaletteItem = {
  readonly command: PlatformCommandId
  readonly description: string
  readonly mode: Theme
  readonly title: string
  readonly value: string
}

export type EditorPaletteItem = {
  readonly active: boolean
  readonly name: string
  readonly content: TabContent
  readonly key: string
  readonly pathLabel: string
}

/**
 * A sub-picker the palette was pushed into by a command rather than by typing.
 * Its mode is held here instead of as prefix text in the input, so the input is
 * empty and searchable the moment it opens.
 */
export type PaletteScope = {
  readonly mode: QuickAccessMode
  /** Search text to restore when the scope is popped; `null` closes the palette. */
  readonly returnSearch: string | null
}

export type { QuickAccessMode } from '@workspace/client-core/commands/palette'

export type QuickOpenFileMatch = {
  readonly birthtimeMs?: number
  readonly mtimeMs?: number
  readonly path: string
  readonly size?: number
  readonly targetType?: TreeEntry['targetType']
  readonly type: TreeEntry['type']
}
