// Per-keyboard-event lookup over a 255-binding table, against the Editor trie when its checkout is
// linked at packages/editor-core, and table construction. Run: bun bench/lookup.ts
import {
  buildKeymapTrie,
  compileKeymap,
  createDispatcher,
  keyInputFromKeyboardEvent,
  trieStep,
} from '../src'
import type { KeyboardEventLike, KeymapBinding, KeymapEntry, RawHotkey } from '../src'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const NAMED = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]
const MASKS = [
  { ctrl: true },
  { ctrl: true, shift: true },
  { alt: true },
  { ctrl: true, alt: true },
  { alt: true, shift: true },
]

/** An editor-shaped table: modifier chords on letters and navigation keys, some two-stroke. */
function editorShapedTable(size: number): RawHotkey[][] {
  const chords: RawHotkey[][] = []
  for (let index = 0; chords.length < size; index += 1) {
    const keys = [...LETTERS, ...NAMED]
    const key = keys[index % keys.length]!
    const mask = MASKS[Math.floor(index / keys.length) % MASKS.length]!
    const stroke = { key, ...mask } as RawHotkey
    const round = Math.floor(index / (keys.length * MASKS.length))
    // Every fourth binding is a Control+K chord, as in VS Code's keymap.
    if (index % 4 === 3)
      chords.push([{ key: 'K', ctrl: true }, { ...stroke, key: `${key}` } as RawHotkey])
    else chords.push(round ? [{ key: `F${(round % 12) + 1}` } as RawHotkey, stroke] : [stroke])
  }
  return chords
}

const ROUNDS = 3
// Results feed this sink so the JIT cannot drop the timed call.
let sink = 0

/** Prints the per-call range over {@link ROUNDS} rounds; returns the fastest round. */
function time(label: string, iterations: number, run: () => unknown) {
  for (let index = 0; index < iterations / 10; index += 1) sink += run() ? 1 : 0
  const rounds: number[] = []
  for (let round = 0; round < ROUNDS; round += 1) {
    const start = performance.now()
    for (let index = 0; index < iterations; index += 1) sink += run() ? 1 : 0
    rounds.push(((performance.now() - start) * 1000) / iterations)
  }
  const low = Math.min(...rounds)
  const high = Math.max(...rounds)
  console.log(`${label.padEnd(58)} ${low.toFixed(3)}–${high.toFixed(3)} µs`)
  return low
}

function keydown(key: string, code: string, ctrlKey = false): KeyboardEventLike {
  return {
    type: 'keydown',
    key,
    code,
    ctrlKey,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: () => false,
  }
}

type EditorTrie = {
  readonly buildKeymapTrie: (bindings: readonly unknown[], platform: 'linux') => unknown
  readonly trieStep: (node: unknown, event: KeyboardEventLike) => unknown
}

async function loadEditorTrie(): Promise<EditorTrie | null> {
  const path = new URL('../../../../packages/editor-core/src/keymap/trie.ts', import.meta.url)
  try {
    return (await import(path.href)) as EditorTrie
  } catch {
    return null
  }
}

const table = editorShapedTable(255)
const bindings: KeymapBinding<number>[] = table.map((chord, payload) => ({
  chord: chord as unknown as KeymapBinding<number>['chord'],
  payload,
}))
const trie = buildKeymapTrie(bindings, 'linux')
const plain = keydown('q', 'KeyQ')
const bound = keydown('e', 'KeyE', true)

console.log(`bindings: ${bindings.length}; per keyboard event, event → edge`)
time('fork: keyInputFromKeyboardEvent + trieStep, plain q', 2_000_000, () =>
  trieStep(trie, keyInputFromKeyboardEvent(plain, 'linux')),
)
time('fork: keyInputFromKeyboardEvent + trieStep, Control+E', 2_000_000, () =>
  trieStep(trie, keyInputFromKeyboardEvent(bound, 'linux')),
)
const editor = await loadEditorTrie()
if (editor) {
  const editorTrie = editor.buildKeymapTrie(bindings, 'linux')
  time('Editor: trieStep(event), plain q', 2_000_000, () => editor.trieStep(editorTrie, plain))
  time('Editor: trieStep(event), Control+E', 2_000_000, () => editor.trieStep(editorTrie, bound))
} else {
  console.log('Editor trie: packages/editor-core is not linked; comparison skipped')
}
const plainInput = keyInputFromKeyboardEvent(plain, 'linux')
time('fork: trieStep on a prebuilt KeyInput, plain q', 2_000_000, () => trieStep(trie, plainInput))

const entries: KeymapEntry[] = table.map((chord, index) => ({
  keys: chord as unknown as readonly [RawHotkey, ...RawHotkey[]],
  command: `command.${index}`,
  context: index % 3 ? 'Editor' : 'Workspace',
}))
const dispatcher = createDispatcher<null>({ platform: 'linux', keymap: entries })
const workspace = dispatcher.createNode({ context: 'Workspace' })
dispatcher.createNode({ parent: workspace, context: 'Editor extension=md' }).focus()
time('dispatcher.handleKey(event), plain q (unbound)', 1_000_000, () =>
  dispatcher.handleKey(keyInputFromKeyboardEvent(plain, 'linux'), null),
)
time('dispatcher.handleKey(event), Control+E (bound, no handler)', 200_000, () =>
  dispatcher.handleKey(keyInputFromKeyboardEvent(bound, 'linux'), null),
)

console.log('construction (compileKeymap):')
let previous = 0
for (const size of [255, 2_550, 25_500]) {
  const sized = editorShapedTable(size).map((chord, index) => ({
    keys: chord as unknown as readonly [RawHotkey, ...RawHotkey[]],
    command: `command.${index}`,
  }))
  const perCall = time(`  ${size} bindings`, size > 3_000 ? 20 : 200, () =>
    compileKeymap(sized, 'linux'),
  )
  const perBinding = perCall / size
  console.log(
    `  ${''.padEnd(50)} ${perBinding.toFixed(3)} µs/binding${previous ? `, ×${(perBinding / previous).toFixed(2)} vs previous size` : ''}`,
  )
  previous = perBinding
}
console.log(`sink ${sink}`)
