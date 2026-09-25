import { ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'
import { streamedFrames } from './stream-frames'

type CodeFrame = {
  readonly coloured: number
  readonly incomplete: boolean
  readonly length: number
}

type Drop = { readonly frame: number; readonly from: CodeFrame; readonly to: CodeFrame }

/**
 * Plan 161 3.2, a reproduction: a fenced block streams in chunks, and the count of coloured
 * token spans must never fall from one animation frame to the next.
 */
export const streamCodeColour = isolatedNativeScenario({
  name: 'stream-code-colour',
  description:
    'Stream a TypeScript fence in about ten chunks and count coloured token spans every animation frame; fails if the count ever drops while the block streams or settles.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration, root }) {
    const blockFrames = await streamedFrames<CodeFrame>(
      page,
      { orchestration, root },
      'Stream the code block.',
      `(answer) => {
        const block = answer.querySelector(${JSON.stringify(selectors.chatCodeBlockSelector)})
        if (!block) return null
        return {
          coloured: block.querySelectorAll('pre code span[style*="--code-token-color"]').length,
          incomplete: block.hasAttribute('data-incomplete'),
          length: (block.querySelector('pre')?.textContent ?? '').length,
        }
      }`,
    )
    const streaming = blockFrames.filter((frame) => frame.incomplete)
    ok(streaming.length > 0, 'The sampler saw the block while it streamed')
    const last = blockFrames.at(-1)
    ok(last && !last.incomplete && last.coloured > 0, 'The settled block is coloured')

    const drops = colourDrops(blockFrames)
    const whileStreaming = drops.filter((drop) => drop.to.incomplete)
    const atSettle = drops.filter((drop) => drop.from.incomplete && !drop.to.incomplete)
    const summary = [
      `${blockFrames.length} block frames (${streaming.length} streaming)`,
      `${new Set(blockFrames.map((frame) => frame.length)).size} text lengths`,
      `max ${Math.max(...blockFrames.map((frame) => frame.coloured))} coloured spans`,
      `${whileStreaming.length} drops while streaming`,
      `${atSettle.length} at settle`,
      `drops ${JSON.stringify(drops.slice(0, 12).map(describeDrop))}`,
    ].join(', ')
    console.log(`stream-code-colour: ${summary}`)
    await step('settled-code-block')
    ok(drops.length === 0, `Coloured spans dropped: ${summary}`)
  },
})

function colourDrops(frames: readonly CodeFrame[]): Drop[] {
  const drops: Drop[] = []
  for (const [index, frame] of frames.entries()) {
    const previous = frames[index - 1]
    if (!previous || frame.coloured >= previous.coloured) continue
    drops.push({ frame: index, from: previous, to: frame })
  }
  return drops
}

function describeDrop(drop: Drop) {
  const phase = drop.to.incomplete ? 'streaming' : 'settle'
  return `#${drop.frame} ${drop.from.coloured}→${drop.to.coloured} ${phase} len ${drop.from.length}→${drop.to.length}`
}
