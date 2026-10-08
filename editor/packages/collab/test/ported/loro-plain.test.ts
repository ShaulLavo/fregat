import { createEngine } from '../engine-fixture'
// loro-dev/loro @ c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// loro-js/tests/richtext-differential.test.ts, random concurrent plain-text
// edits converge with Rust, seeds 1–20, 80 steps; generator in
// loro-js/tests/support/richtext-differential.ts (see loro-plain-workload.ts).
// Adapted to Singapore ID-space edits: host convergence and a local string
// oracle replace Rust/WASM differential comparison. Each edit is an envelope;
// commit actions leave delivery queued. Undo and rich-text work are excluded.
// Copyright (c) 2023 Loro. MIT; see ../../THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { liveIds, network } from './adapter'
import { plainActions, scalarBoundaries } from './loro-plain-workload'

const stress = process.env.COLLAB_STRESS === '1'
const seeds = Array.from({ length: stress ? 200 : 20 }, (_, index) => index + 1)

test.each(seeds)(
  'Loro host-adapted plain-text differential seed %i',
  (seed) => {
    const net = network(3)
    const actions = plainActions(seed, stress ? 240 : 80)
    for (const action of actions) {
      if (action.type === 'commit') continue
      if (action.type === 'sync') {
        net.sync([action.from, action.to])
        const restored = createEngine()
        restored.restore(net.engine.snapshot())
        expect(restored.text()).toBe(net.host.text())
        expect(liveIds(restored)).toEqual(liveIds(net.engine))
        continue
      }
      const before = net.users[action.peer]!.participant.text()
      const boundaries = scalarBoundaries(before)
      if (action.type === 'insert') {
        const offset = boundaries[action.pos % boundaries.length]!
        net.edit(action.peer, { offset, deleteCount: 0, text: action.text })
        expect(net.users[action.peer]!.participant.text()).toBe(
          before.slice(0, offset) + action.text + before.slice(offset),
        )
        continue
      }
      if (boundaries.length < 2) continue
      const index = action.pos % (boundaries.length - 1)
      const offset = boundaries[index]!
      const end = boundaries[Math.min(boundaries.length - 1, index + action.len)]!
      net.edit(action.peer, { offset, deleteCount: end - offset, text: '' })
      expect(net.users[action.peer]!.participant.text()).toBe(
        before.slice(0, offset) + before.slice(end),
      )
    }
    const result = net.settle()
    expect(result).not.toMatch(/[\uD800-\uDFFF]/u)
  },
  30_000,
)
