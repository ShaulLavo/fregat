import { CharIdAllocator, charIdAfter } from '@singapore-editor/textbuffer'
import { Host, ReferenceEngine, TextbufferEngine } from '../src/index'
import { charKey, editKey } from '../src/types'
import type { EditId, Envelope, OffsetEdit } from '../src/index'
import { createEngine, type TestEngine } from './engine-fixture'
import { randomSource } from './ported/adapter'
import { fugueMaxReplica, type OracleEdit } from './ported/fixtures/fugue-max-oracle'

export function identityState(engine: TestEngine) {
  const ids: string[] = []
  if (engine instanceof ReferenceEngine) ids.push(...engine.orderedIds().map(charKey))
  if (!(engine instanceof ReferenceEngine)) {
    const snapshot = (engine as TextbufferEngine).snapshot().buffer
    for (let id = charIdAfter(snapshot, 'start'); id; id = charIdAfter(snapshot, id))
      ids.push(charKey(id))
  }
  return {
    text: engine.text(),
    ids,
    visibleIds: engine
      .characters()
      .filter((node) => !node.deleted)
      .sort((a, b) => a.offset - b.offset)
      .map((node) => charKey(node.id)),
  }
}

export function historyAuthor(actor: string) {
  const engine = createEngine()
  const oracle = fugueMaxReplica()
  const allocator = new CharIdAllocator(actor)
  const known = new Map<string, OracleEdit>()
  const frontier = new Map<string, EditId>()
  const own: Envelope[] = []
  let sequence = 0
  let lamport = 0
  function observe(edits: readonly OracleEdit[]) {
    for (const edit of edits) {
      const envelope = edit.envelope
      const key = editKey(envelope.id)
      if (known.has(key)) continue
      engine.apply(envelope)
      oracle.apply(edit)
      record(edit)
    }
  }
  function record(edit: OracleEdit) {
    const envelope = edit.envelope
    known.set(editKey(envelope.id), edit)
    for (const dep of envelope.deps) frontier.delete(editKey(dep))
    frontier.set(editKey(envelope.id), envelope.id)
    lamport = Math.max(lamport, envelope.lamport)
  }
  function author(
    change: OffsetEdit | { readonly target: Envelope; readonly active: boolean },
  ): OracleEdit {
    const id = { actor, seq: ++sequence }
    const metadata = {
      document: 'test',
      epoch: '1',
      id,
      lamport: lamport + 1,
      deps: [...frontier.values()],
    }
    const envelope: Envelope =
      'target' in change
        ? {
            ...metadata,
            change: {
              kind: 'setEffects',
              command: id,
              effects: [{ op: change.target.id, active: change.active }],
            },
          }
        : engine.author(change, {
            ...metadata,
            allocate: (left, count) => allocator.generateAfter(left, count),
          })
    const edit = oracle.author(envelope, 'offset' in change ? change.offset : 0)
    engine.apply(envelope)
    if (oracle.text() !== engine.text())
      throw new TypeError('Author projection differs from upstream FugueMax')
    own.push(envelope)
    record(edit)
    return edit
  }
  return { actor, engine, oracle, known, own, observe, author }
}

export function randomEdit(text: string, random: () => number, step: number): OffsetEdit {
  const offset =
    random() < 0.5 ? Math.min(1, text.length) : Math.floor(random() * (text.length + 1))
  const remove = text.length > offset && step % 4 < 2
  const deleteCount = remove ? Math.min(text.length - offset, 1 + Math.floor(random() * 3)) : 0
  return {
    offset,
    deleteCount,
    text:
      deleteCount && step % 4 === 0
        ? ''
        : String.fromCharCode(97 + (step % 26)).repeat(1 + (step % 3)),
  }
}

export function concurrentHistory(
  seed: number,
  effects: boolean,
  count = 40,
): readonly OracleEdit[] {
  const random = randomSource(seed)
  const authors = Array.from({ length: 3 + (seed % 3) }, (_, index) =>
    historyAuthor(`actor${index}`),
  )
  const edits: OracleEdit[] = [authors[0]!.author({ offset: 0, deleteCount: 0, text: 'AB' })]
  for (const author of authors) author.observe(edits)
  // Every author backward-types twice at the same initial gap before observing another branch.
  for (const author of authors) {
    edits.push(author.author({ offset: 1, deleteCount: 0, text: 'y' }))
    edits.push(author.author({ offset: 1, deleteCount: 0, text: 'x' }))
    const deletion = author.author({ offset: 1, deleteCount: 1, text: '' })
    edits.push(deletion, author.author({ offset: 1, deleteCount: 1, text: 'z' }))
    if (!effects) continue
    edits.push(author.author({ target: deletion.envelope, active: false }))
    edits.push(author.author({ offset: 1, deleteCount: 0, text: 'u' }))
    edits.push(author.author({ target: deletion.envelope, active: true }))
  }
  for (let step = 0; step < count; step++) {
    const author = authors[Math.floor(random() * authors.length)]!
    if (random() < 0.35) {
      const other = authors[Math.floor(random() * authors.length)]!
      author.observe(edits.filter((edit) => other.known.has(editKey(edit.envelope.id))))
    }
    const targets = author.own.filter((edit) => edit.change.kind !== 'setEffects')
    const change =
      effects && step % 5 === 0 && targets.length
        ? { target: targets[Math.floor(random() * targets.length)]!, active: step % 10 !== 0 }
        : randomEdit(author.engine.text(), random, step)
    edits.push(author.author(change))
  }
  return edits
}

export function causalOrder(edits: readonly OracleEdit[], seed: number): readonly OracleEdit[] {
  const random = randomSource(seed)
  const remaining = [...edits]
  const seen = new Set<string>()
  const result: OracleEdit[] = []
  while (remaining.length) {
    const ready = remaining.flatMap((edit, index) =>
      edit.envelope.deps.every((dep) => seen.has(editKey(dep))) ? [index] : [],
    )
    if (!ready.length) throw new TypeError('History has missing or cyclic dependencies')
    const index = ready[Math.floor(random() * ready.length)]!
    const edit = remaining.splice(index, 1)[0]!
    result.push(edit)
    seen.add(editKey(edit.envelope.id))
  }
  return result
}

export function direct(edits: readonly OracleEdit[]) {
  const engine = createEngine()
  const oracle = fugueMaxReplica()
  const host = new Host({ document: 'test', epoch: '1', engine, unknownDeps: 'reject' })
  for (const edit of edits) {
    const message = host.submit(edit.envelope, edit.envelope.id.actor)
    if (message.status !== 'accepted')
      throw new TypeError(`Unexpected host outcome ${JSON.stringify(message)}`)
    oracle.apply(edit)
  }
  return { engine, oracle, host }
}
