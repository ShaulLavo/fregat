// Main-thread cost spellcheck adds to a keystroke: `bun run bench:typing`.
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
  const sparse = text.replaceAll(/^(\d*[1-3]) (.*)befor/gm, '$1 $2before')
  const cases = [
    ['off', text],
    ['no marks', text],
    ['a mark per line', text],
    ['a mark every 4 lines', sparse],
  ] as const
  for (const [mode, source] of cases) {
    const { total, controller } = await keystrokeTimes(source, mode)
    console.log(
      `BENCH ${mode}: keystroke median ${fmt(percentile(total, 0.5))} p95 ${fmt(percentile(total, 0.95))} ms; spellcheck median ${fmt(percentile(controller, 0.5))} p95 ${fmt(percentile(controller, 0.95))} ms`,
    )
  }
})

async function keystrokeTimes(text: string, mode: string) {
  const checker = new FakeChecker(mode.startsWith('a mark') ? ['befor'] : [])
  const plugins = mode === 'off' ? [] : [createSpellcheckPlugin({ service: checker })]
  const { host, editor } = mountEditor(plugins)
  host.style.height = '600px'
  editor.setText(text)
  await checker.answerAll()
  const middle = text.indexOf('\n1000 ') + 6
  editor.setSelection(middle)
  const total: number[] = []
  const controller: number[] = []
  for (let index = 0; index < KEYSTROKES; index++) {
    const at = middle + index
    controllerMs = 0
    const start = performance.now()
    editor.edit({ from: at, to: at, text: index % 6 === 5 ? ' ' : 'x' })
    editor.setSelection(at + 1)
    total.push(performance.now() - start)
    controller.push(controllerMs)
    if (index % 20 === 0) await checker.answerAll()
  }
  disposeEditors()
  return { total, controller }
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

function fmt(value: number): string {
  return value.toFixed(3)
}
