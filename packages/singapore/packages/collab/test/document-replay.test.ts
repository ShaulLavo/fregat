import { expect, test, vi } from 'vitest'
import { CollaborationDocument } from '../../collaboration/src/document'
import { createEditorSnapshotBuffer } from '../../editor/src/documentSession'
import { materializePieceTableFullText } from '@singapore-editor/textbuffer'

const options = { document: 'test', epoch: '1', text: '' }

test('production split replay publishes two exact reconciles with linear participant work', () => {
  const count = process.env.COLLABORATION_LONG_RUN === '1' ? 2_000 : 64
  const winning = new CollaborationDocument({ ...options, peer: 'winning' })
  const losing = new CollaborationDocument({ ...options, peer: 'losing' })
  const winnerEdits = winning.participant.localBatch(
    Array.from({ length: count }, (_, offset) => ({ offset, deleteCount: 0, text: 'w' })),
  )
  const losingEdits = losing.participant.localBatch(
    Array.from({ length: count }, (_, offset) => ({ offset, deleteCount: 0, text: 'l' })),
  )
  winning.sequenceBatch(winnerEdits.map((edit) => ({ edit })))
  losing.sequenceBatch(losingEdits.map((edit) => ({ edit })))
  const buffer = createEditorSnapshotBuffer(losing.engine.snapshot().buffer)
  const reconcile = vi.spyOn(buffer, 'reconcile')
  const apply = vi.spyOn(losing.engine, 'apply')
  const restore = vi.spyOn(losing.engine, 'restore')
  losing.participant.subscribe(({ edits }) => {
    buffer.reconcile(losing.engine.snapshot().buffer, [], { origin: 'remote', edits })
    expect(materializePieceTableFullText(buffer.getSnapshot())).toBe(losing.engine.text())
  })
  losing.install(winning.exportHistory(winning.genesis)!, losingEdits)
  const records = winning.sequenceBatch(losingEdits.map((edit) => ({ edit })))
  expect(losing.applyBatch(records)).toBe(true)
  expect(apply.mock.calls.length).toBeLessThanOrEqual(2 * count)
  expect(restore).toHaveBeenCalledTimes(1)
  expect(reconcile).toHaveBeenCalledTimes(2)
  expect(reconcile.mock.calls[1]![2]!.edits).toEqual([])
  expect(losing.engine.text()).toBe(winning.engine.text())
  expect(losing.checkpoint()).toEqual(winning.checkpoint())
  expect(losing.participant.state().pending).toEqual([])
})

test('batch confirmation publishes its valid prefix before rejecting a forged suffix', () => {
  const winning = new CollaborationDocument({ ...options, peer: 'winning' })
  const follower = new CollaborationDocument({ ...options, peer: 'follower' })
  const edits = winning.participant.localBatch([
    { offset: 0, deleteCount: 0, text: 'a' },
    { offset: 1, deleteCount: 0, text: 'b' },
  ])
  const records = winning.sequenceBatch(edits.map((edit) => ({ edit })))
  const publish = vi.fn()
  follower.participant.subscribe(publish)
  expect(follower.applyBatch([records[0]!, { ...records[1]!, hash: 'forged' }])).toBe(false)
  expect(publish).toHaveBeenCalledTimes(1)
  expect(follower.engine.text()).toBe('a')
  expect(follower.applyBatch(records.slice(1))).toBe(true)
  expect(publish).toHaveBeenCalledTimes(2)
  expect(follower.engine.text()).toBe('ab')
})
