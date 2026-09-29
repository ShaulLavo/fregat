// Plan 203 benchmark: plain-key lookup over a 255-binding table and table construction.
// Run: bun bench/lookup.ts
import { buildKeymapTrie, compileKeymap, createDispatcher, createKeyInput, trieStep } from '../src'
import type { KeymapBinding, KeymapEntry, RawHotkey } from '../src'

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

function time(label: string, iterations: number, run: () => void) {
  for (let index = 0; index < iterations / 10; index += 1) run()
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) run()
  const perCall = ((performance.now() - start) * 1000) / iterations
  console.log(`${label.padEnd(52)} ${perCall.toFixed(3)} µs`)
  return perCall
}

const table = editorShapedTable(255)
const bindings: KeymapBinding<number>[] = table.map((chord, payload) => ({
  chord: chord as unknown as KeymapBinding<number>['chord'],
  payload,
}))
const trie = buildKeymapTrie(bindings, 'linux')
const plain = createKeyInput({ key: 'q', code: 'KeyQ' })
const bound = createKeyInput({ key: 'e', code: 'KeyE', modifiers: { ctrl: true } })

console.log(`bindings: ${bindings.length}`)
time('trieStep, plain q (unbound)', 2_000_000, () => void trieStep(trie, plain))
time('trieStep, Control+E (bound)', 2_000_000, () => void trieStep(trie, bound))

const entries: KeymapEntry[] = table.map((chord, index) => ({
  keys: chord as unknown as readonly [RawHotkey, ...RawHotkey[]],
  command: `command.${index}`,
  context: index % 3 ? 'Editor' : 'Workspace',
}))
const dispatcher = createDispatcher<null>({ platform: 'linux', keymap: entries })
const workspace = dispatcher.createNode({ context: 'Workspace' })
dispatcher.createNode({ parent: workspace, context: 'Editor extension=md' }).focus()
time(
  'dispatcher.handleKey, plain q (unbound)',
  1_000_000,
  () => void dispatcher.handleKey(plain, null),
)
time(
  'dispatcher.handleKey, Control+E (bound, no handler)',
  200_000,
  () => void dispatcher.handleKey(bound, null),
)

console.log('construction (compileKeymap):')
let previous = 0
for (const size of [255, 2_550, 25_500]) {
  const sized = editorShapedTable(size).map((chord, index) => ({
    keys: chord as unknown as readonly [RawHotkey, ...RawHotkey[]],
    command: `command.${index}`,
  }))
  const perCall = time(
    `  ${size} bindings`,
    size > 3_000 ? 20 : 200,
    () => void compileKeymap(sized, 'linux'),
  )
  const perBinding = perCall / size
  console.log(
    `  ${''.padEnd(50)} ${perBinding.toFixed(3)} µs/binding${previous ? `, ×${(perBinding / previous).toFixed(2)} vs previous size` : ''}`,
  )
  previous = perBinding
}
