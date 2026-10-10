import assert from 'node:assert/strict'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import {
  CharIdAllocator,
  charIdAt,
  createPieceTableSnapshot,
  insertByCharId,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '../dist/index.js'

const samples = 21
const warmups = 5
const typingEdits = 500
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
function timing(label, setup, run, validate) {
  const measurements = []
  const keystrokes = []
  for (let sample = -warmups; sample < samples; sample++) {
    const state = setup()
    const start = performance.now()
    run(state)
    const elapsed = performance.now() - start
    validate(state)
    if (sample >= 0) {
      measurements.push(elapsed)
      if (state.keystrokes) keystrokes.push(...state.keystrokes)
    }
  }
  const sorted = keystrokes.sort((a, b) => a - b)
  return {
    label,
    medianMs: median(measurements),
    samplesMs: measurements,
    ...(keystrokes.length
      ? {
          keystrokeMedianMs: sorted[Math.floor(sorted.length / 2)],
          keystrokeP95Ms: sorted[Math.floor(sorted.length * 0.95)],
          keystrokeMaxMs: sorted.at(-1),
          keystrokesOverBudget: keystrokes.filter((value) => value > 8.3).length,
        }
      : {}),
  }
}
const workloads = []
for (const lines of [10_000, 100_000]) {
  const text = `${'x'.repeat(80)}\n`.repeat(lines)
  const original = createPieceTableSnapshot(text, {
    normalized: true,
    charIds: { bunch: 'initial:0', counter: 0 },
  })
  const offset = Math.floor(text.length / 2)
  workloads.push({
    lines,
    ...timing(
      'identity-storage-typing',
      () => ({ buffer: original, ids: new CharIdAllocator('local'), keystrokes: [] }),
      (state) => {
        for (let i = 0; i < typingEdits; i++) {
          const before = performance.now()
          const left = charIdAt(state.buffer, offset + i - 1)
          state.buffer = insertByCharId(state.buffer, {
            start: state.ids.generateAfter(left, 1),
            text: 'a',
            at: { after: left },
          })
          state.keystrokes.push(performance.now() - before)
        }
      },
      (state) =>
        assert.equal(
          materializePieceTableFullText(state.buffer),
          text.slice(0, offset) + 'a'.repeat(typingEdits) + text.slice(offset),
        ),
    ),
    edits: typingEdits,
  })
  workloads.push({
    lines,
    ...timing(
      'engine-author-and-apply-typing',
      () => ({
        engine: new TextbufferEngine(original),
        ids: new CharIdAllocator('local'),
        keystrokes: [],
      }),
      (state) => {
        for (let i = 0; i < typingEdits; i++) {
          const before = performance.now()
          const envelope = state.engine.author(
            { offset: offset + i, deleteCount: 0, text: 'a' },
            {
              document: 'bench',
              epoch: '1',
              id: { actor: 'local', seq: i + 1 },
              lamport: i + 1,
              deps: [],
              allocate: (left, count) => state.ids.generateAfter(left, count),
            },
          )
          state.engine.apply(envelope)
          state.keystrokes.push(performance.now() - before)
        }
      },
      (state) =>
        assert.equal(
          state.engine.text(),
          text.slice(0, offset) + 'a'.repeat(typingEdits) + text.slice(offset),
        ),
    ),
    edits: typingEdits,
  })
  for (const pending of [1, 10, 100]) {
    workloads.push({
      lines,
      pending,
      ...timing(
        'remote-arrival-reconcile',
        () => {
          const engine = new TextbufferEngine(original)
          const user = new Participant({ actor: 'local', document: 'bench', epoch: '1', engine })
          for (let i = 0; i < pending; i++)
            user.local({ offset: offset + i, deleteCount: 0, text: 'a' })
          const remote = new Participant({
            actor: 'remote',
            document: 'bench',
            epoch: '1',
            engine: new TextbufferEngine(original),
          })
          const envelope = remote.local({ offset, deleteCount: 0, text: 'R' })
          return {
            user,
            message: { document: 'bench', epoch: '1', sequence: 1, status: 'accepted', envelope },
          }
        },
        (state) => state.user.receive([state.message]),
        (state) => {
          assert.equal(
            state.user.text(),
            text.slice(0, offset) + 'a'.repeat(pending) + 'R' + text.slice(offset),
          )
          assert.equal(state.user.state().pending.length, pending)
        },
      ),
    })
  }
}
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        v8: process.versions.v8,
        cpu: os.cpus()[0]?.model,
        release: os.release(),
        platform: process.platform,
      },
      method:
        '21 in-process samples after 5 warmups. Setup and exact text validation outside timers. Typing is 500 edits; burst and per-keystroke timings include author/apply, allocation and timer overhead. Reconcile is one remote arrival with unchanged 1/10/100 pending local edits. No browser rendering or editor consumer cost.',
      workloads,
    },
    null,
    2,
  ),
)
