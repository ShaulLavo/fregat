import { detectPlatform } from './platform'
import { parseRegisterableHotkey } from './parse'
import { keysEqual } from './_keyboard-event'
import { matchesKeyboardEvent } from './match'
import { getHotkeyRegistry } from './hotkeys'
import type { HotkeyRegistrationView, HotkeyRegistry } from './hotkeys'
import type { ParsedHotkey, RegisterableHotkey } from './hotkey.types'

export type HotkeyConflict = {
  type: 'hotkey' | 'sequence'
  registration: HotkeyRegistrationView
}

export interface HotkeyConflictOptions {
  /** Intended registration target. Defaults to document; disjoint targets are excluded. */
  target?: HTMLElement | Document | Window
  /** Check all targets instead of overlapping targets. Default: overlapping. */
  scope?: 'overlapping' | 'all'
  /** Intended event type. Default: keydown. */
  eventType?: 'keydown' | 'keyup'
  /** Include disabled registrations. Default: false. */
  includeDisabled?: boolean
  /** IDs of registrations being edited. */
  excludeIds?: ReadonlyArray<string>
  /** Additional app-specific exclusions, such as all instances of one action. */
  exclude?: (registration: HotkeyRegistrationView) => boolean
  /** Platform used to resolve Mod in the candidate. Registrations retain their own platform. */
  platform?: 'mac' | 'windows' | 'linux'
  /** Source events allow detecting physical/logical overlap on the recorded layout. */
  events?: ReadonlyArray<KeyboardEvent>
  /** Registry to search. Defaults to the document's. */
  registry?: HotkeyRegistry
}

/** Whether two targets share a document and one contains the other (or is its window). */
function targetsOverlap(
  a: HTMLElement | Document | Window,
  b: HTMLElement | Document | Window,
): boolean {
  if (a === b) return true
  // Resolve the owning document without relying on cross-frame instanceof checks.
  const documentOf = (target: typeof a): Document | null => {
    if ('document' in target) return target.document
    if (target.nodeType === 9) return target as Document
    return target.ownerDocument
  }
  if (documentOf(a) !== documentOf(b)) return false
  if (!('contains' in a) || !('contains' in b)) return true
  return a.contains(b) || b.contains(a)
}

/**
 * Find equivalent bindings and sequence-prefix conflicts in the live registry.
 * With source events, also checks observed logical/physical overlap. Does not
 * discover unmounted handlers, external listeners, or other keyboard layouts.
 */
export function findHotkeyConflicts(
  candidate: RegisterableHotkey | ReadonlyArray<RegisterableHotkey>,
  options: HotkeyConflictOptions = {},
): Array<HotkeyConflict> {
  const steps: ReadonlyArray<RegisterableHotkey> = Array.isArray(candidate)
    ? candidate
    : [candidate as RegisterableHotkey]
  if (steps.length === 0) return []
  const platform = options.platform ?? detectPlatform()
  const parsed = steps.map((step) => parseRegisterableHotkey(step, platform))
  const target = options.target ?? (typeof document === 'undefined' ? undefined : document)
  const conflicts: Array<HotkeyConflict> = []
  // Apply scope policy before comparing equivalent bindings or observed event overlap.
  const matches = (registration: HotkeyRegistrationView, bindings: ReadonlyArray<ParsedHotkey>) => {
    if (
      (!options.includeDisabled && registration.options.enabled === false) ||
      (registration.options.eventType ?? 'keydown') !== (options.eventType ?? 'keydown') ||
      options.excludeIds?.includes(registration.id) ||
      options.exclude?.(registration) ||
      (options.scope !== 'all' && target && !targetsOverlap(target, registration.target))
    )
      return false
    // Compare only the common prefix: a shorter sequence can collide with a longer one.
    return parsed.slice(0, Math.min(parsed.length, bindings.length)).every((a, index) => {
      const b = bindings[index]!
      const same =
        a.ctrl === b.ctrl &&
        a.alt === b.alt &&
        a.shift === b.shift &&
        a.meta === b.meta &&
        (a.code !== undefined || b.code !== undefined ? a.code === b.code : keysEqual(a.key, b.key))
      // A source event can establish code/key overlap without guessing its layout.
      const event = options.events?.[index]
      return (
        same ||
        (event !== undefined &&
          matchesKeyboardEvent(event, a, platform) &&
          matchesKeyboardEvent(event, b, registration.options.platform))
      )
    })
  }
  const registry = options.registry ?? getHotkeyRegistry()
  for (const registration of registry.registrations.state.values()) {
    if (matches(registration, registration.strokes))
      conflicts.push({
        type: registration.strokes.length > 1 ? 'sequence' : 'hotkey',
        registration,
      })
  }
  return conflicts
}
