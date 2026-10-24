import { expect, test, vi } from 'vitest'
import { MergeReviewDetector } from '../src/merge-review'
import { CollaborationDocument } from '../src/document'
import { MergeReview } from '../src/review'
import type { MergeReviewSyntax } from '../src/merge-review'

const syntax: MergeReviewSyntax = async (snapshot, ranges) =>
  ranges.map(() => [
    {
      startIndex: 0,
      endIndex: snapshot.length,
      type: 'line',
      languageId: 'text',
      signature: null,
      hasErrors: false,
      parent: null,
    },
  ])

function fixture(reader = syntax, onError?: (error: unknown) => void) {
  const options = { document: 'doc', epoch: 'epoch', text: 'const value = 0;\n' }
  const a = new CollaborationDocument({ ...options, peer: 'alice' })
  const b = new CollaborationDocument({ ...options, peer: 'bob' })
  const tasks: (() => void)[] = []
  let calls = 0
  const applied: { from: number; to: number; text: string }[] = []
  const review = new MergeReview(
    a,
    'alice',
    {
      onError,
      syntax: Object.assign(
        async (...args: Parameters<MergeReviewSyntax>) => {
          calls++
          return reader(...args)
        },
        { release: 'release' in reader ? (reader.release as () => Promise<void>) : undefined },
      ),
    },
    (edit) => {
      applied.push(edit)
    },
    (run) => {
      tasks.push(run)
      return () => {}
    },
  )
  return {
    a,
    b,
    review,
    tasks,
    applied,
    get calls() {
      return calls
    },
    async flush() {
      for (const task of tasks.splice(0)) task()
      await review.idle()
    },
  }
}

test('confirmed batches schedule review outside authoring, with no single-author detector calls', async () => {
  const f = fixture()
  expect(f.tasks).toHaveLength(0)
  const edit = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  f.a.sequence(edit)
  await f.flush()
  expect(f.calls).toBe(0)
  f.review.dispose()
})

test('only confirmations create marks and dismissal remains local', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  expect(f.calls).toBe(0)
  expect(f.review.marks).toEqual([])
  const records = f.a.sequenceBatch([{ edit: left }, { edit: right }])
  f.b.applyBatch(records)
  const peer = new MergeReview(
    f.b,
    'bob',
    { syntax },
    () => {},
    (run) => {
      f.tasks.push(run)
      return () => {}
    },
  )
  await f.flush()
  await peer.idle()
  expect(f.review.marks.length).toBeGreaterThan(0)
  expect(f.review.marks.map((mark) => mark.unitId)).toEqual(peer.marks.map((mark) => mark.unitId))
  f.review.dismiss(f.review.marks[0]!)
  expect(f.review.marks).toEqual([])
  expect(peer.marks.length).toBeGreaterThan(0)
  f.review.dispose()
  peer.dispose()
})

test('author versions and bounded ordinary-edit resolution preserve the selected author', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const mark = f.review.marks[0]!
  expect(f.review.versions(mark)?.base).toBe('const value = 0;\n')
  expect(f.review.versions(mark)?.authors).toEqual([
    { author: 'alice', text: 'const value = 1;\n' },
    { author: 'bob', text: 'const value = 2;\n' },
  ])
  expect(f.review.resolve(mark, 'alice')).toBe(true)
  expect(f.applied).toHaveLength(1)
  const edit = f.applied[0]!
  expect(edit.from).toBeGreaterThanOrEqual(mark.unit.startIndex)
  expect(edit.to).toBeLessThanOrEqual(mark.unit.endIndex)
  f.review.dispose()
})

test('an action from a stale hover never changes the document', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const mark = f.review.marks[0]!
  f.a.sequence(f.a.participant.local({ offset: 0, deleteCount: 0, text: '// note\n' }))
  expect(f.review.resolve(mark, 'alice')).toBe(false)
  expect(f.applied).toEqual([])
  await f.flush()
  f.review.dispose()
})

test('cross-unit effects stay manual and jump locates an edit beyond the marked unit', async () => {
  const f = fixture(async (snapshot, ranges) =>
    ranges.map(() => [
      {
        startIndex: 0,
        endIndex: 16,
        type: 'line',
        languageId: 'text',
        signature: null,
        hasErrors: false,
        parent: null,
      },
    ]),
  )
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 2, text: '2;\n// after' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const mark = f.review.marks[0]!
  expect(mark).toBeDefined()
  expect(f.review.canResolve(mark, 'alice')).toBe(false)
  expect(f.review.resolve(mark, 'alice')).toBe(false)
  expect(f.applied).toEqual([])
  expect(f.review.jumpOffset(mark)).toBeGreaterThanOrEqual(mark.unit.endIndex)
  f.review.dispose()
})

test('history reset invalidates a hover and a dismissed mark stays local across later batches', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const mark = f.review.marks[0]!
  f.review.dismiss(mark)
  f.a.install(f.a.exportHistory(f.a.genesis)!)
  expect(f.review.resolve(mark, 'alice')).toBe(false)
  await f.flush()
  expect(f.review.marks).toEqual([])
  f.a.install([])
  await f.flush()
  expect(f.review.marks).toEqual([])
  f.review.dispose()
})

test('obsolete detection retires its snapshots before the next confirmed batch publishes', async () => {
  let unblock!: () => void
  let first = true
  const released: number[] = []
  const reader = Object.assign(
    async (...args: Parameters<MergeReviewSyntax>) => {
      if (first) {
        first = false
        await new Promise<void>((resolve) => {
          unblock = resolve
        })
      }
      return syntax(...args)
    },
    {
      release: async () => {
        released.push(1)
      },
    },
  )
  const f = fixture(reader)
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  for (const task of f.tasks.splice(0)) task()
  f.a.sequence(f.b.participant.local({ offset: 0, deleteCount: 0, text: '// after\n' }))
  unblock()
  // The injected scheduler holds the replacement run until this assertion has observed staleness.
  await new Promise<void>((resolve) => {
    const poll = () => (f.tasks.length ? resolve() : queueMicrotask(poll))
    poll()
  })
  expect(f.review.marks).toEqual([])
  expect(released).toHaveLength(1)
  await f.flush()
  expect(released).toHaveLength(2)
  expect(f.review.marks.length).toBeGreaterThan(0)
  f.review.dispose()
})

test('dismissed hover actions cannot change text', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const mark = f.review.marks[0]!
  f.review.dismiss(mark)
  expect(f.review.versions(mark)).toBeNull()
  expect(f.review.resolve(mark, 'alice')).toBe(false)
  expect(f.applied).toEqual([])
  f.review.dispose()
})

test('a release failure reports the error and allows the next confirmed review', async () => {
  const errors: unknown[] = []
  const failure = { operation: 'release' }
  let releases = 0
  const reader = Object.assign(async (...args: Parameters<MergeReviewSyntax>) => syntax(...args), {
    release: async () => {
      if (releases++ === 0) throw failure
    },
  })
  const f = fixture(reader, (error) => errors.push(error))
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  f.a.sequence(f.b.participant.local({ offset: 0, deleteCount: 0, text: '// after\n' }))
  await f.flush()
  expect(errors).toEqual([failure])
  expect(releases).toBe(2)
  expect(f.review.marks.length).toBeGreaterThan(0)
  f.review.dispose()
})

test('rejected foreign effects do not introduce another text author', async () => {
  const f = fixture()
  const edit = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  f.a.sequence(edit)
  const id = { actor: 'bob', seq: 1 }
  const record = f.a.sequence({
    ...edit,
    id,
    change: {
      kind: 'setEffects',
      command: id,
      effects: [{ op: edit.id, active: false }],
    },
  })
  expect(record.outcome.kind).toBe('rejected')
  await f.flush()
  expect(f.calls).toBe(0)
  f.review.dispose()
})

test('rejected-only batches leave published reviews intact and schedule no syntax work', async () => {
  const f = fixture()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  const marks = f.review.marks
  const calls = f.calls
  const id = { actor: 'charlie', seq: 1 }
  const record = f.a.sequence({
    ...left,
    id,
    change: {
      kind: 'setEffects',
      command: id,
      effects: [{ op: left.id, active: false }],
    },
  })
  expect(record.outcome.kind).toBe('rejected')
  expect(f.tasks).toEqual([])
  expect(f.review.marks).toEqual(marks)
  await f.flush()
  expect(f.calls).toBe(calls)
  f.review.dispose()
})

test('disposed reviews unsubscribe before another confirmed batch', async () => {
  const f = fixture()
  f.review.dispose()
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.a.sequenceBatch([{ edit: left }, { edit: right }])
  await f.flush()
  expect(f.calls).toBe(0)
  expect(f.tasks).toEqual([])
})

for (const author of ['alice', 'bob']) {
  test(`a settled ${author} resolution retires the group on every peer`, async () => {
    const f = fixture()
    const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
    const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
    f.b.applyBatch(f.a.sequenceBatch([{ edit: left }, { edit: right }]))
    const peer = new MergeReview(
      f.b,
      'bob',
      { syntax },
      () => {},
      (run) => {
        f.tasks.push(run)
        return () => {}
      },
    )
    await f.flush()
    await peer.idle()
    const mark = f.review.marks[0]!
    expect(f.review.resolve(mark, author)).toBe(true)
    const opposite = author === 'alice' ? 'bob' : 'alice'
    const staleApplied = f.review.resolve(mark, opposite)
    const edit = f.applied[0]!
    f.b.applyBatch(
      f.a.sequenceBatch([
        {
          edit: f.a.participant.local({
            offset: edit.from,
            deleteCount: edit.to - edit.from,
            text: edit.text,
          }),
        },
      ]),
    )
    await f.flush()
    await peer.idle()
    expect([f.review.marks, peer.marks]).toEqual([[], []])
    expect(staleApplied).toBe(false)
    expect(f.applied).toHaveLength(1)
    expect(f.review.versions(mark)).toBeNull()
    expect(f.review.resolve(mark, opposite)).toBe(false)
    // A later remote confirmation cannot resurrect the superseded concurrency edge.
    f.a.sequence(f.b.participant.local({ offset: 0, deleteCount: 0, text: '// after\n' }))
    await f.flush()
    expect(f.review.marks).toEqual([])
    f.review.dispose()
    peer.dispose()
  })
}

test('a local-only confirmation in a multi-author document dispatches no detector', async () => {
  const detector = vi.spyOn(MergeReviewDetector.prototype, 'detect')
  const f = fixture()
  try {
    const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
    const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
    f.a.sequenceBatch([{ edit: left }, { edit: right }])
    await f.flush()
    const calls = detector.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    const old = f.review.marks[0]!
    f.a.sequence(f.a.participant.local({ offset: 0, deleteCount: 0, text: '// local only\n' }))
    await f.flush()
    expect(detector.mock.calls).toHaveLength(calls)
    expect(f.review.resolve(old, 'alice')).toBe(false)
  } finally {
    f.review.dispose()
    detector.mockRestore()
  }
})

test('remote demand waits for our concurrent pending confirmation without running on later local batches', async () => {
  const f = fixture()
  const local = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  f.a.sequence(f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' }))
  await f.flush()
  expect(f.calls).toBe(0)
  f.a.sequence(local)
  await f.flush()
  expect(f.review.marks).toHaveLength(1)
  const calls = f.calls
  f.a.sequence(f.a.participant.local({ offset: 0, deleteCount: 0, text: '// local\n' }))
  await f.flush()
  expect(f.calls).toBe(calls)
  f.review.dispose()
})

for (const author of ['alice', 'bob']) {
  test(`a deletion-only ${author} resolution retires the group for a fresh attachment`, async () => {
    const f = fixture()
    const left = f.a.participant.local({ offset: 6, deleteCount: 2, text: '' })
    const right = f.b.participant.local({ offset: 7, deleteCount: 2, text: '' })
    f.b.applyBatch(f.a.sequenceBatch([{ edit: left }, { edit: right }]))
    await f.flush()
    expect(f.review.resolve(f.review.marks[0]!, author)).toBe(true)
    const edit = f.applied[0]!
    f.b.applyBatch(
      f.a.sequenceBatch([
        {
          edit: f.a.participant.local({
            offset: edit.from,
            deleteCount: edit.to - edit.from,
            text: edit.text,
          }),
        },
      ]),
    )
    const peer = new MergeReview(
      f.b,
      'bob',
      { syntax },
      () => {},
      (run) => {
        f.tasks.push(run)
        return () => {}
      },
    )
    await f.flush()
    await peer.idle()
    expect(f.b.engine.text()).toBe(author === 'alice' ? 'const lue = 0;\n' : 'const vue = 0;\n')
    expect([f.review.marks, peer.marks]).toEqual([[], []])
    f.review.dispose()
    peer.dispose()
  })
}

test('a causal follow-up in another unit preserves the competing alternatives', async () => {
  const f = fixture(async (_snapshot, ranges) =>
    ranges.map(() => [
      {
        startIndex: 0,
        endIndex: 16,
        type: 'line',
        languageId: 'text',
        signature: null,
        hasErrors: false,
        parent: null,
      },
    ]),
  )
  const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
  const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
  f.b.applyBatch(f.a.sequenceBatch([{ edit: left }, { edit: right }]))
  await f.flush()
  expect(f.review.marks).toHaveLength(1)
  const later = f.b.participant.local({
    offset: f.b.confirmedSnapshot().buffer.length,
    deleteCount: 0,
    text: 'const other = 3;\n',
  })
  f.b.apply(f.a.sequence(later))
  await f.flush()
  expect(f.review.marks).toHaveLength(1)
  expect(f.review.marks[0]!.authors).toEqual(['alice', 'bob'])
  f.review.dispose()
})

test('remote demand waits for pending acknowledgement even with multiple retained authors', async () => {
  const detect = vi.spyOn(MergeReviewDetector.prototype, 'detect')
  const f = fixture()
  try {
    const left = f.a.participant.local({ offset: 14, deleteCount: 1, text: '1' })
    const right = f.b.participant.local({ offset: 14, deleteCount: 1, text: '2' })
    f.b.applyBatch(f.a.sequenceBatch([{ edit: left }, { edit: right }]))
    await f.flush()
    const before = detect.mock.calls.length
    const pending = f.a.participant.local({ offset: 14, deleteCount: 2, text: '3' })
    const remote = f.b.participant.local({ offset: 14, deleteCount: 2, text: '4' })
    f.b.apply(f.a.sequence(remote))
    await f.flush()
    expect(detect).toHaveBeenCalledTimes(before)
    f.b.apply(f.a.sequence(pending))
    await f.flush()
    expect(detect).toHaveBeenCalledTimes(before + 1)
    expect(f.review.marks).toHaveLength(1)
    expect(f.review.versions(f.review.marks[0]!)!.authors.map(({ text }) => text)).toEqual([
      'const value = 3;\n',
      'const value = 4;\n',
    ])
  } finally {
    f.review.dispose()
    detect.mockRestore()
  }
})
