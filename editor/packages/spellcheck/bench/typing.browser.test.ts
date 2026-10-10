import { tokenizeSpellWords } from '../src/tokenizer'
import { commands } from 'vitest/browser'
// Main-thread cost spellcheck adds to a keystroke: `bun run bench:typing`.
import type { VirtualizedTextView } from '../../editor/src/virtualization/virtualizedTextView'
import { afterEach, it } from 'vitest'
import { SpellcheckController } from '../src/controller'
import { createSpellcheckPlugin } from '../src/plugin'
import { disposeEditors, mountEditor } from '../test/browserEditor'
import { FakeChecker } from '../test/fakeChecker'

const SENTENCE =
  'The list settles befor the cursor moves, and the reader keeps their place while results stream in. '
const LINES = 2000
const KEYSTROKES = 300

afterEach(disposeEditors)

// Time inside the controller: the synchronous share spellcheck adds to each keystroke.
let controllerMs = 0
const update = SpellcheckController.prototype.update
SpellcheckController.prototype.update = function (this: SpellcheckController, ...args) {
  const start = performance.now()
  try {
    update.apply(this, args)
  } finally {
    controllerMs += performance.now() - start
  }
}

it('measures keystroke cost with and without spellcheck', { timeout: 120_000 }, async () => {
  const text = Array.from({ length: LINES }, (_, line) => `${line} ${SENTENCE}`).join('\n')
  const sparse = text
    .split('\n')
    .map((line, index) => (index % 4 === 0 ? line : line.replace('befor', 'before')))
    .join('\n')
  const cases = [
    ['off', text],
    ['no marks', text],
    ['a mark per line', text],
    ['a mark every 4 lines', sparse],
  ] as const
  for (const [mode, source] of cases) {
    const { total, controller, highlight, adoption } = await keystrokeTimes(source, mode)
    console.log(
      `BENCH ${mode}: keystroke median ${fmt(percentile(total, 0.5))} p95 ${fmt(percentile(total, 0.95))} ms; spellcheck median ${fmt(percentile(controller, 0.5))} p95 ${fmt(percentile(controller, 0.95))} ms; highlight median ${fmt(percentile(highlight, 0.5))} p95 ${fmt(percentile(highlight, 0.95))} ms; token adoption median ${fmt(percentile(adoption, 0.5))} p95 ${fmt(percentile(adoption, 0.95))} ms`,
    )
  }
})

async function keystrokeTimes(text: string, mode: string) {
  const checker = new FakeChecker(mode.startsWith('a mark') ? ['befor'] : [])
  const plugins = mode === 'off' ? [] : [createSpellcheckPlugin({ service: checker })]
  const { host, editor } = mountEditor(plugins)
  let highlightMs = 0
  let adoptionMs = 0
  const view: VirtualizedTextView = Reflect.get(editor, 'view')
  const setHighlight = view.setRangeHighlight.bind(view)
  view.setRangeHighlight = (...args) => {
    const start = performance.now()
    setHighlight(...args)
    highlightMs += performance.now() - start
  }
  const adopt = view.adoptTokens.bind(view)
  view.adoptTokens = (...args) => {
    const start = performance.now()
    adopt(...args)
    adoptionMs += performance.now() - start
  }
  host.style.height = '600px'
  editor.setText(text)
  await checker.answerAll()
  const middle = text.indexOf('\n1000 ') + 6
  editor.setSelection(middle)
  const total: number[] = []
  const controller: number[] = []
  const highlight: number[] = []
  const adoption: number[] = []
  for (let index = 0; index < KEYSTROKES; index++) {
    const at = middle + index
    controllerMs = 0
    highlightMs = 0
    adoptionMs = 0
    const start = performance.now()
    editor.edit({ from: at, to: at, text: index % 6 === 5 ? ' ' : 'x' })
    editor.setSelection(at + 1)
    total.push(performance.now() - start)
    controller.push(controllerMs)
    highlight.push(highlightMs)
    adoption.push(adoptionMs)
    if (index % 20 === 0) await checker.answerAll()
  }
  disposeEditors()
  return { total, controller, highlight, adoption }
}

function percentile(values: number[], fraction: number): number {
  const sorted = values.sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

function fmt(value: number): string {
  return value.toFixed(3)
}

it('profiles dense underline typing', { timeout: 120_000 }, async () => {
  const text = Array.from({ length: LINES }, (_, line) => `${line} ${SENTENCE}`).join('\n')
  await commands.proofProfileStart()
  await keystrokeTimes(text, 'a mark per line')
  console.log('PROFILE', JSON.stringify(await commands.proofProfileStop()))
})

it('measures uncached tokenizer work separately from editor painting', () => {
  for (const text of [
    SENTENCE,
    'a'.repeat(5_000),
    'a'.repeat(10_000),
    'a'.repeat(20_000),
    'a.@/'.repeat(5_000),
  ]) {
    const samples: number[] = []
    for (let trial = 0; trial < 101; trial++) {
      const start = performance.now()
      tokenizeSpellWords(text)
      samples.push(performance.now() - start)
    }
    console.log(
      `TOKENIZE ${text.length} code units: median ${fmt(percentile(samples, 0.5))} p95 ${fmt(percentile(samples, 0.95))} ms`,
    )
  }
})
