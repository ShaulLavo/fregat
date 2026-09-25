import { ok } from 'node:assert/strict'
import { isolatedNativeScenario } from './native-provider-verification'
import { streamedFrames } from './stream-frames'

type TailFrame = { readonly text: string; readonly headings: number; readonly tables: number }

/** Markup the final answer only ever carries as syntax: none of it may reach the text. */
const STRAY_SYNTAX = ['#', '`', '|', '*', '-']

/** Plan 161 3.1: a live tail ending in `#`, a backtick, a table header or a list marker is held. */
export const streamAmbiguousTail = isolatedNativeScenario({
  name: 'stream-ambiguous-tail',
  description:
    'Stream an answer whose tail pauses on `#`, `## `, an open backtick, a table header without its separator and a bare list marker; no animation frame may paint that syntax as text.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration, root }) {
    const frames = await streamedFrames<TailFrame>(
      page,
      { orchestration, root },
      'Stream the ambiguous tails.',
      `(answer) => ({
        text: answer.textContent ?? '',
        headings: answer.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        tables: answer.querySelectorAll('table').length,
      })`,
    )
    const states = new Set(frames.map((frame) => frame.text))
    ok(states.size >= 8, `The sampler saw the stream grow (${states.size} distinct texts)`)
    const last = frames.at(-1)
    ok(last?.text.includes('Done.'), 'The final frame holds the whole answer')
    ok(
      last && last.headings === 1 && last.tables === 1,
      'The settled answer has its heading and table',
    )

    const stray = frames.filter((frame) => STRAY_SYNTAX.some((mark) => frame.text.includes(mark)))
    ok(
      stray.length === 0,
      `${stray.length} of ${frames.length} frames painted raw syntax, first: ${JSON.stringify(stray[0]?.text)}`,
    )
    console.log(`stream-ambiguous-tail: ${frames.length} frames, ${states.size} texts, 0 stray`)
    await step('settled-answer')
  },
})
