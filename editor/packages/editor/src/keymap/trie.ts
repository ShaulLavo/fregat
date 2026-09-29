import {
  LETTER_KEYS,
  NUMBER_KEYS,
  PUNCTUATION_CODE_MAP,
  normalizeKeyName,
  normalizeRegisterableHotkey,
  parseHotkey,
  rawHotkeyToParsedHotkey,
} from '@tanstack/hotkeys'
import type { KeymapBinding, KeymapPlatform } from './types'

const LATIN_LETTER_PATTERN = /^[a-z]$/i

export type KeymapNode<Payload> = {
  readonly next: ReadonlyMap<string, readonly (KeymapEdge<Payload> | undefined)[]>
  readonly candidates: readonly KeymapBinding<Payload>[]
  readonly descendants: readonly KeymapBinding<Payload>[]
}
export type KeymapEdge<Payload> = { readonly keys: string; readonly node: KeymapNode<Payload> }
type MutableNode<Payload> = {
  next: Map<string, ({ keys: string; node: MutableNode<Payload> } | undefined)[]>
  candidates: KeymapBinding<Payload>[]
  descendants: KeymapBinding<Payload>[]
}
export function buildKeymapTrie<Payload>(
  bindings: readonly KeymapBinding<Payload>[],
  platform: KeymapPlatform,
): KeymapNode<Payload> {
  const root = emptyNode<Payload>()
  for (const binding of bindings) insertBinding(root, binding, platform)
  return root
}
function emptyNode<Payload>(): MutableNode<Payload> {
  return { next: new Map(), candidates: [], descendants: [] }
}
function insertBinding<Payload>(
  root: MutableNode<Payload>,
  binding: KeymapBinding<Payload>,
  platform: KeymapPlatform,
) {
  let node = root
  for (const stroke of binding.chord) {
    node.descendants.push(binding)
    const parsed =
      typeof stroke === 'string'
        ? parseHotkey(stroke, platform)
        : rawHotkeyToParsedHotkey(stroke, platform)
    const modifiers = modifierMask(parsed.alt, parsed.ctrl, parsed.meta, parsed.shift)
    const strokeKey = parsed.key ?? PHYSICAL_KEY_NAMES.get(parsed.code) ?? parsed.code
    const edges = node.next.get(strokeKey) ?? []
    let edge = edges[modifiers]
    if (!edge) edge = { keys: normalizeRegisterableHotkey(stroke, platform), node: emptyNode() }
    edges[modifiers] = edge
    node.next.set(strokeKey, edges)
    node = edge.node
  }
  node.candidates.push(binding)
}
export function trieStep<Payload>(
  node: KeymapNode<Payload>,
  event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): KeymapEdge<Payload> | null {
  const printed = normalizeKeyName(event.key)
  const modifiers = modifierMask(event.altKey, event.ctrlKey, event.metaKey, event.shiftKey)
  const edge = node.next.get(printed)?.[modifiers]
  if (edge) return edge
  // A Latin layout owns its printed letters; AZERTY Z must not activate physical W.
  if (LATIN_LETTER_PATTERN.test(printed)) return null
  const physical = PHYSICAL_KEY_NAMES.get(event.code)
  if (!physical) return null
  return node.next.get(physical)?.[modifiers] ?? null
}
function modifierMask(alt: boolean, ctrl: boolean, meta: boolean, shift: boolean): number {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0)
}
const PHYSICAL_KEY_NAMES = physicalKeyNames()
function physicalKeyNames(): ReadonlyMap<string, string> {
  const names = new Map(Object.entries(PUNCTUATION_CODE_MAP))
  // TanStack omits Quote, but non-Latin layouts still need its physical key.
  names.set('Quote', "'")
  for (const letter of LETTER_KEYS) names.set(`Key${letter}`, letter)
  for (const digit of NUMBER_KEYS) names.set(`Digit${digit}`, digit)
  return names
}
