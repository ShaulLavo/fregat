import { normalizeRegisterableHotkey } from '../parse'
import { buildKeymapTrie, trieStep } from '../chords/trie'
import { parseContextPredicate, predicateDepth } from '../context/predicate'
import type { RegisterableHotkey } from '../hotkey.types'
import type { KeyInput } from '../key-input'
import type { KeyContext } from '../context/key-context'
import type { ContextPredicate } from '../context/predicate'
import type { KeyChord, KeymapBinding, KeymapPlatform } from '../chords/types'
import type { KeymapSelection } from '../chords/runtime'
import type { KeymapNode } from '../chords/trie'

/** Where a binding comes from; later sources win ties: a user binding beats a pack beats a default. */
export type BindingSource = 'default' | 'pack' | 'user'
/** A chord as strokes, or one string with strokes separated by spaces (`'Mod+K Mod+C'`). */
export type BindingKeys = KeyChord | string

/**
 * A key→command pair, active where `context` matches the focus path. `command: null`
 * removes equal and weaker sources' bindings for these keys where it matches.
 */
export type Binding = {
  readonly keys: BindingKeys
  readonly command: string | null
  readonly args?: unknown
  readonly context?: string
  readonly source?: BindingSource
}
/** Removes one key→command pair where `context` matches, leaving other commands on the keys. */
export type Unbinding = {
  readonly keys: BindingKeys
  readonly unbind: string
  readonly context?: string
  readonly source?: BindingSource
}
export type KeymapEntry = Binding | Unbinding

/** A table entry after parsing, carried as the trie payload. */
export type CompiledBinding = {
  readonly entry: KeymapEntry
  readonly command: string | null
  readonly unbind: string | null
  readonly predicate: ContextPredicate | undefined
  readonly rank: number
  readonly index: number
  /** Normalized chord, for comparing entries on the same keys. */
  readonly chord: string
}
export type CompiledKeymap = {
  readonly platform: KeymapPlatform
  readonly bindings: readonly KeymapBinding<CompiledBinding>[]
  readonly root: KeymapNode<CompiledBinding>
}

const SOURCE_RANK: Readonly<Record<BindingSource, number>> = { default: 0, pack: 1, user: 2 }

/** Parses the table once: chords, predicates and ranks; linear in the number of strokes. */
export function compileKeymap(
  entries: readonly KeymapEntry[],
  platform: KeymapPlatform,
): CompiledKeymap {
  const bindings = entries.map((entry, index) => compileEntry(entry, index, platform))
  return { platform, bindings, root: buildKeymapTrie(bindings, platform) }
}

function compileEntry(
  entry: KeymapEntry,
  index: number,
  platform: KeymapPlatform,
): KeymapBinding<CompiledBinding> {
  const chord = toChord(entry.keys)
  const isUnbind = 'unbind' in entry
  return {
    chord,
    payload: {
      entry,
      command: isUnbind ? null : entry.command,
      unbind: isUnbind ? entry.unbind : null,
      predicate: entry.context === undefined ? undefined : parseContextPredicate(entry.context),
      rank: SOURCE_RANK[entry.source ?? 'user'],
      index,
      chord: chord.map((stroke) => normalizeRegisterableHotkey(stroke, platform)).join(' '),
    },
  }
}

function toChord(keys: BindingKeys): KeyChord {
  if (typeof keys !== 'string') return keys
  const strokes = keys.trim().split(/\s+/) as RegisterableHotkey[]
  return strokes as unknown as KeyChord
}

type Ranked = { readonly depth: number; readonly binding: KeymapBinding<CompiledBinding> }

/**
 * Zed's `bindings_for_input` for one trie node: the commands to try in order, and how many
 * longer chords keep the input pending. Candidates rank by the deepest context their predicate
 * matches, then source, then table order (later first).
 */
export function resolveKeymapNode(
  node: KeymapNode<CompiledBinding>,
  stack: readonly KeyContext[],
): KeymapSelection<CompiledBinding> {
  const ranked: Ranked[] = []
  for (const binding of node.candidates) {
    const depth = predicateDepth(binding.payload.predicate, stack)
    if (depth !== null) ranked.push({ depth, binding })
  }
  ranked.sort(compareRanked)
  const bindings = actionable(ranked)
  const first = bindings[0]?.payload.index ?? -1
  return { bindings, pending: pendingChords(node.descendants, stack, first) }
}

function compareRanked(a: Ranked, b: Ranked): number {
  return (
    b.depth - a.depth ||
    b.binding.payload.rank - a.binding.payload.rank ||
    b.binding.payload.index - a.binding.payload.index
  )
}

function actionable(ranked: readonly Ranked[]): KeymapBinding<CompiledBinding>[] {
  const bindings: KeymapBinding<CompiledBinding>[] = []
  const unbound: CompiledBinding[] = []
  let nullRank = -1
  for (const { binding } of ranked) {
    const { payload } = binding
    if (payload.command === null && payload.unbind === null) {
      nullRank = Math.max(nullRank, payload.rank)
      continue
    }
    if (payload.rank <= nullRank) continue
    if (payload.unbind !== null) {
      unbound.push(payload)
      continue
    }
    if (unbound.some((removal) => removes(removal, payload))) continue
    bindings.push(binding)
  }
  return bindings
}

function removes(removal: CompiledBinding, binding: CompiledBinding): boolean {
  return removal.chord === binding.chord && removal.unbind === binding.command
}

// A longer chord defined before the winning exact binding is shadowed by it; removals cancel chords.
// Descendants are already in table order: the trie inserts bindings in order.
function pendingChords(
  descendants: readonly KeymapBinding<CompiledBinding>[],
  stack: readonly KeyContext[],
  firstIndex: number,
): number {
  const chords = new Set<string>()
  for (const { payload } of descendants) {
    if (payload.index < firstIndex) continue
    if (predicateDepth(payload.predicate, stack) === null) continue
    if (payload.command === null) chords.delete(payload.chord)
    else chords.add(payload.chord)
  }
  return chords.size
}

/** What a sequence of keys resolves to under a context stack, for settings and tests. */
export function bindingsForInput(
  keymap: CompiledKeymap,
  inputs: readonly KeyInput[],
  stack: readonly KeyContext[],
): { readonly bindings: readonly CompiledBinding[]; readonly pending: boolean } {
  let node: KeymapNode<CompiledBinding> | null = keymap.root
  for (const input of inputs) {
    node = trieStep(node, input)?.node ?? null
    if (!node) return { bindings: [], pending: false }
  }
  const selection = resolveKeymapNode(node, stack)
  return {
    bindings: selection.bindings.map((binding) => binding.payload),
    pending: selection.pending > 0,
  }
}
