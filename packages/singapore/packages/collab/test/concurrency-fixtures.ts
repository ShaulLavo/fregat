import { Host, Participant, ReferenceEngine } from '../src/index'
import type { Envelope } from '../src/index'
import { editKey } from '../src/types'

export function randomFor(seed: number) {
  let value = seed + 1
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 0x100000000
  }
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function confirmedHistory(seed: number): readonly Envelope[] {
  const random = randomFor(seed)
  const host = new Host({ document: 'review', epoch: '1', engine: new ReferenceEngine() })
  const messages: Parameters<Participant['receive']>[0][number][] = []
  host.subscribe((message) => messages.push(message))
  const peers = ['a', 'b', 'c', 'd'].map(
    (actor) =>
      new Participant({ actor, document: 'review', epoch: '1', engine: new ReferenceEngine() }),
  )
  for (let round = 0; round < 8; round++) {
    const batch: Envelope[] = []
    for (const peer of peers) {
      if (random() > 0.25) peer.receive(messages)
      const length = peer.text().length
      const offset = Math.floor(random() * (length + 1))
      const deleteCount = offset < length && random() > 0.5 ? 1 : 0
      const text = deleteCount && random() > 0.75 ? '' : peer.actor
      batch.push(peer.local({ offset, deleteCount, text }))
    }
    for (const edit of shuffled(batch, random)) host.submit(edit, edit.id.actor)
  }
  return messages.flatMap((message) => (message.status === 'accepted' ? [message.envelope] : []))
}

export function oraclePairs(edits: readonly Envelope[]): readonly string[] {
  const byId = new Map(edits.map((edit) => [editKey(edit.id), edit]))
  const sees = (observer: Envelope, target: Envelope) => {
    const stack = [...observer.deps]
    const visited = new Set<string>()
    while (stack.length) {
      const id = stack.pop()!
      const key = editKey(id)
      if (key === editKey(target.id)) return true
      if (visited.has(key)) continue
      visited.add(key)
      stack.push(...(byId.get(key)?.deps ?? []))
    }
    return false
  }
  const result: string[] = []
  for (let i = 0; i < edits.length; i++) {
    const left = edits[i]!
    if (left.change.kind === 'setEffects') continue
    for (const right of edits.slice(i + 1)) {
      if (right.change.kind === 'setEffects' || left.id.actor === right.id.actor) continue
      if (!sees(left, right) && !sees(right, left)) result.push(pairKey(left, right))
    }
  }
  return result.sort()
}

export function pairKey(left: Envelope, right: Envelope): string {
  return [editKey(left.id), editKey(right.id)].sort().join('|')
}
