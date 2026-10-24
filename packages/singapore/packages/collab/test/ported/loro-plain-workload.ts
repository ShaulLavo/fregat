// loro-dev/loro @ c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// loro-js/tests/support/richtext-differential.ts, Random, generateActions,
// boundaries, pickBoundary and pickRange, with marks/undo/checkout/revert/
// snapshots/movableList/cursors/crossRuntimeSync disabled.
// Adapted to Singapore ID-space edits. Copyright (c) 2023 Loro.
// MIT; see ../../THIRD_PARTY_TEST_NOTICES.md.

const texts = ['a', 'b', 'cd', 'xyz', 'é', '中文', '😀', 'a😀b', '👍🏽', '\n', 'ab\ncd', '𝒳y']

type Action =
  | { readonly type: 'insert'; readonly peer: number; readonly pos: number; readonly text: string }
  | { readonly type: 'delete'; readonly peer: number; readonly pos: number; readonly len: number }
  | { readonly type: 'sync'; readonly from: number; readonly to: number }
  | { readonly type: 'commit'; readonly peer: number }

export function plainActions(seed: number, steps: number): readonly Action[] {
  let state = (Math.imul(seed, 2_654_435_761) + 0x9e37_79b9) >>> 0 || 1
  const next = () => {
    let value = state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    state = value >>> 0
    return state
  }
  const integer = (bound: number) => next() % bound
  const actions: Action[] = []
  const commitMaybe = (peer: number) => {
    if (integer(5) !== 0) actions.push({ type: 'commit', peer })
  }
  for (let step = 0; step < steps; step++) {
    const peer = integer(3)
    const roll = integer(100)
    const pos = next()
    const len = 1 + integer(6)
    if (roll < 32) {
      const text = integer(4) === 0 ? `${step % 10}` : texts[integer(texts.length)]!
      actions.push({ type: 'insert', peer, pos, text })
      commitMaybe(peer)
      continue
    }
    if (roll < 48) {
      actions.push({ type: 'delete', peer, pos, len })
      commitMaybe(peer)
      continue
    }
    if (roll < 80) {
      const others = [0, 1, 2].filter((id) => id !== peer)
      const to = others[integer(2)]!
      integer(2) // Preserve the upstream JSON/binary-choice draw; both use the same host log.
      actions.push({ type: 'sync', from: peer, to })
      continue
    }
    actions.push({ type: 'commit', peer })
  }
  return actions
}

export function scalarBoundaries(value: string): readonly number[] {
  const positions = [0]
  let offset = 0
  for (const scalar of value) {
    offset += scalar.length
    positions.push(offset)
  }
  return positions
}
