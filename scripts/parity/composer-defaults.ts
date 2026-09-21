import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { resolveComposerInteractionMode } from '../../packages/client-core/src/chat/composer-interaction'
import { pin, readPinned } from './pinned'
const source = readPinned(`apps/web/src/components/ChatView.logic.ts`)
const start = source.indexOf('export function resolveComposerInteractionMode(')
const end = source.indexOf('export function getAntigravitySendBlockReason(', start)
strictEqual(start >= 0 && end > start, true)
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end))
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
let comparisons = 0
for (const planModeEnabled of [true, false]) {
  for (const provider of [
    null,
    undefined,
    {},
    { showInteractionModeToggle: true },
    { showInteractionModeToggle: false },
  ]) {
    for (const interactionMode of ['plan', 'default'] as const) {
      const input = { planModeEnabled, provider, interactionMode }
      deepStrictEqual(
        resolveComposerInteractionMode(input),
        upstream.resolveComposerInteractionMode(input),
      )
      comparisons++
    }
  }
}
console.log(JSON.stringify({ pin, comparisons }))
