import { describe, expect, test } from 'vitest'
import { bufferSpanAt } from './buffers'
import { createPieceTableSnapshot, deleteFromPieceTable, insertIntoPieceTable } from './index'
import { reclaimSnapshotStorage } from './reclamation'
import { TextPageOwner, TextPageRegistry } from './textPages'

function drain(job: Generator<void, unknown>): void {
  while (!job.next().done) {
    // Exercise the incremental collector to completion.
  }
}

describe('borrowed measurement pages', () => {
  test('keeps cold reads borrowed, then releases backing for unread and already measured readers', () => {
    const original = createPieceTableSnapshot('x'.repeat(80_000) + '\ud834\udd1e\tend')
    const span = bufferSpanAt(original.buffers, original.buffers.original, 0)
    const unread = span.owner.page(span.text, 80_000, 80_006)
    const read = span.owner.page(span.text, 79_999, 80_006)
    expect(read.slice(0, read.length)).toBe('x𝄞\tend')
    expect(read.storageLength).toBe(original.length)
    const current = deleteFromPieceTable(original, 0, 80_000)
    drain(reclaimSnapshotStorage([current]))
    expect(unread.storageLength).toBe(6)
    expect(unread.slice(0, unread.length)).toBe('𝄞\tend')
    expect(read.storageLength).toBe(7)
    expect(read.charCodeAt(1)).toBe(0xd834)
    expect(read.charCodeAt(read.length)).toBeNaN()
    const sparse = bufferSpanAt(current.buffers, current.buffers.original, 80_000)
    const owned = sparse.owner.page(sparse.text, 1, 4)
    expect(owned.storageLength).toBe(6)
    drain(reclaimSnapshotStorage([current]))
    expect(owned.storageLength).toBe(6)
    expect(owned.slice(0, 3)).toBe('\udd1e\te')
  })

  test('reuses exact borrowed spans across renders and immutable tail extensions', () => {
    const owner = new TextPageOwner(new TextPageRegistry())
    const text = 'x'.repeat(16_384)
    const pages = Array.from({ length: 16 }, (_, index) =>
      owner.page(text, index * 1024, index * 1024 + 64),
    )
    for (let render = 0; render < 100; render++) {
      for (let index = 0; index < pages.length; index++)
        expect(owner.page(text + 'tail', index * 1024, index * 1024 + 64)).toBe(pages[index])
    }
    expect(owner.page(text, 0, 65)).not.toBe(pages[0])
  })

  test('shares growing backing without enlarging detached pages or shrinking for old views', () => {
    const registry = new TextPageRegistry()
    const owner = new TextPageOwner(registry)
    const first = owner.page('abcd', 0, 2)
    const second = owner.page('abcdef', 2, 4)
    expect(first.storageLength).toBe(6)
    expect(owner.page('abcd', 0, 2)).toBe(first)
    expect(first.storageLength).toBe(6)
    const sweep = registry.detachRetired(new Set())
    expect(sweep.next().done).toBe(false)
    expect(first.storageLength).toBe(2)
    expect(second.storageLength).toBe(6)
    const later = owner.page('abcdefgh', 4, 8)
    expect(second.storageLength).toBe(8)
    expect(first.storageLength).toBe(2)
    expect(first.slice(0, 2)).toBe('ab')
    expect(second.slice(0, 2)).toBe('cd')
    const sibling = new TextPageOwner(registry).page('ABCD', 0, 2)
    expect(sibling.slice(0, 2)).toBe('AB')
    expect(first.slice(0, 2)).toBe('ab')
    drain(sweep)
    expect(later.storageLength).toBe(4)
    expect(later.slice(0, 4)).toBe('efgh')
  })

  test('finds pages from abandoned sibling logs without copying another document', () => {
    const base = createPieceTableSnapshot('base')
    const sibling = insertIntoPieceTable(base, 0, 's'.repeat(12_000))
    const span = bufferSpanAt(sibling.buffers, sibling.buffers.nextBufferSequence - 1, 0)
    const page = span.owner.page(span.text, 100, 132)
    const other = createPieceTableSnapshot('o'.repeat(80_000))
    const otherSpan = bufferSpanAt(other.buffers, other.buffers.original, 0)
    const untouched = otherSpan.owner.page(otherSpan.text, 0, 16_384)
    drain(reclaimSnapshotStorage([base]))
    expect(page.storageLength).toBe(32)
    expect(page.slice(0, 32)).toBe('s'.repeat(32))
    expect(untouched.storageLength).toBe(80_000)
  })

  test('preserves original readers while another protected group still owns the text', () => {
    const original = createPieceTableSnapshot('x'.repeat(80_000))
    const span = bufferSpanAt(original.buffers, original.buffers.original, 0)
    const page = span.owner.page(span.text, 20, 40)
    const branch = insertIntoPieceTable(original, 0, 'first')
    const sibling = insertIntoPieceTable(original, 0, 'other')
    const deleted = deleteFromPieceTable(branch, 5, 79_990)
    drain(reclaimSnapshotStorage([deleted, sibling]))
    expect(page.storageLength).toBe(80_000)
    drain(reclaimSnapshotStorage([deleted]))
    expect(page.storageLength).toBe(20)
  })

  test('finishes detaching after cancellation following storage publication', () => {
    const original = createPieceTableSnapshot('x'.repeat(80_000))
    const span = bufferSpanAt(original.buffers, original.buffers.original, 0)
    const page = span.owner.page(span.text, 0, 20)
    const current = deleteFromPieceTable(original, 20, 79_980)
    const before = current.buffers
    const job = reclaimSnapshotStorage([current])
    while (current.buffers === before) expect(job.next().done).toBe(false)
    job.return({ chunks: 0, codeUnits: 0, snapshots: 0 })
    drain(reclaimSnapshotStorage([current]))
    expect(page.storageLength).toBe(20)
    expect(page.slice(0, 20)).toBe('x'.repeat(20))
  })

  test('includes pages created during a sweep and yields while skipping protected owners', () => {
    const registry = new TextPageRegistry()
    const owner = new TextPageOwner(registry)
    const first = owner.page('a'.repeat(100), 0, 20)
    const job = registry.detachRetired(new Set())
    expect(job.next().done).toBe(false)
    const late = owner.page('a'.repeat(100), 20, 50)
    drain(job)
    expect(first.storageLength).toBe(20)
    expect(late.storageLength).toBe(30)
    const text = 'c'.repeat(1024)
    const protectedPages = Array.from({ length: 512 }, (_, index) =>
      owner.page(text, index, index + 2),
    )
    const protectedJob = registry.detachRetired(new Set([owner]))
    expect(protectedJob.next().done).toBe(false)
    drain(protectedJob)
    expect(protectedPages.every((page) => page.storageLength === 1024)).toBe(true)
  })
})
