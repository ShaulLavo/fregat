import { expect, test } from 'vitest'
import { CollaborationDocument } from '../../collaboration/src/document'
import { compareBranches } from '../../collaboration/src/protocol'
import type { Envelope } from '../src/index'
import { editKey } from '../src/types'
import { randomSource } from './ported/adapter'
import { fugueMaxReplica, type OracleEdit } from './ported/fixtures/fugue-max-oracle'
import { causalOrder, direct, historyAuthor, identityState, randomEdit } from './order-fixtures'
import { SessionDocument, sessionNetwork } from './session-order-fixtures'

const stress = process.env.COLLAB_STRESS === '1' || process.env.COLLABORATION_LONG_RUN === '1'
const changes = stress ? 2_000 : 48

for (const effects of [false, true]) {
  test.each(['fixture', 'document'] as const)(
    `offline split/rejoin equals CRDT-direct integration, effects=${effects}, adapter=%s`,
    (adapter) => {
      const documents = Array.from({ length: 4 }, (_, index) =>
        adapter === 'fixture'
          ? new SessionDocument(`actor${index}`, stress)
          : new CollaborationDocument({
              peer: `actor${index}`,
              document: 'test',
              epoch: '1',
              text: '',
            }),
      )
      const base = documents[0] instanceof CollaborationDocument ? documents[0].genesis : undefined
      const net = sessionNetwork(documents, base)
      // Stress batches avoid rebuilding the reference projection after each confirmation.
      const authors = stress ? documents.map((_, index) => historyAuthor(`actor${index}`)) : []
      const oracles = stress
        ? authors.map((author) => author.oracle)
        : documents.map(() => fugueMaxReplica())
      const edits: OracleEdit[] = []
      const own = documents.map(() => [] as Envelope[])
      const random = randomSource(8168)
      function author(index: number, group: readonly number[], step: number) {
        const document = documents[index]!
        const target = own[index]!.find((edit) => edit.change.kind !== 'setEffects')
        const writer = authors[index]
        let change = randomEdit((writer?.engine ?? document.engine).text(), random, step)
        if (step < 8) change = { offset: 1, deleteCount: 0, text: 'x' }
        if (step < 0) change = { offset: 0, deleteCount: 0, text: 'AB' }
        const toggle = effects && step >= 8 && step % 7 === 0 && target
        const active = Math.floor(step / 7) % 2 === 0
        let edit: OracleEdit
        if (writer) {
          edit = toggle ? writer.author({ target: toggle, active }) : writer.author(change)
        } else {
          const envelope = toggle
            ? document.participant.setEffects([{ op: toggle.id, active }])
            : document.participant.local(change, { boundary: true })
          edit = oracles[index]!.author(envelope, change.offset)
        }
        const envelope = edit.envelope
        edits.push(edit)
        own[index]!.push(envelope)
        net.sessions[index]!.submit(envelope)
        if (!stress || step < 0) net.advance(2)
        for (const peer of group) {
          if (!stress) expect(documents[peer]!.outcome(envelope.id)).toEqual({ kind: 'accepted' })
          if (peer === index) continue
          if (writer) authors[peer]!.observe([edit])
          if (!writer) oracles[peer]!.apply(edit)
        }
      }
      net.partition([[0, 1, 2, 3]])
      author(0, [0, 1, 2, 3], -1)
      net.partition([
        [0, 1],
        [2, 3],
      ])
      expect(net.sessions.filter((session) => session.isHost)).toHaveLength(2)
      for (const group of [
        [0, 1],
        [2, 3],
      ]) {
        for (let step = 0; step < changes; step++) author(group[step % 2]!, group, step)
        net.advance(2)
        for (const index of group) {
          const document = documents[index]!
          if (document instanceof SessionDocument) document.settleProjection()
          expect(document.engine.text()).toBe(oracles[index]!.text())
          expect(documents[index]!.checkpoint().depth).toBe(changes + 1)
        }
      }
      const winner = compareBranches(net.sessions[0]!.branch, net.sessions[2]!.branch) <= 0 ? 0 : 2
      const loser = winner === 0 ? 2 : 0
      const losing = documents[loser]!.exportHistory(
        base ?? { depth: 0, hash: 'order-independence-genesis' },
      )!
        .slice(1)
        .map((record) => record.edit)
      const losingOrigins = new Map(losing.map((edit) => [editKey(edit.id), JSON.stringify(edit)]))
      net.confirmationSizes.length = 0
      net.partition([[0, 1, 2, 3]])
      for (
        let retry = 0;
        retry < 8 && documents.some((document) => document.checkpoint().depth !== edits.length);
        retry++
      )
        net.advance()
      expect(net.sessions.filter((session) => session.isHost)).toHaveLength(1)
      expect(net.commits()).toBeGreaterThan(0)
      expect(net.confirmationSizes.some((size) => size > 1)).toBe(true)
      expect(net.confirmationSizes.length).toBeLessThanOrEqual(12)
      const replayed = new Map(net.replay.map((edit) => [editKey(edit.id), JSON.stringify(edit)]))
      for (const [key, envelope] of losingOrigins) expect(replayed.get(key)).toBe(envelope)
      const directMerge = direct(causalOrder(edits, 20261009))
      const expected = identityState(directMerge.engine)
      expect(expected).toEqual({
        text: directMerge.oracle.text(),
        ids: directMerge.oracle.ids(),
        visibleIds: directMerge.oracle.visibleIds(),
      })
      for (const document of documents) {
        if (document instanceof SessionDocument) document.settleProjection()
        expect(document.checkpoint().depth).toBe(edits.length)
        expect(document.participant.state().pending).toEqual([])
        expect(document.participant.state().blocked).toEqual([])
        expect(identityState(document.engine)).toEqual(expected)
        for (const edit of edits)
          expect(document.outcome(edit.envelope.id)).toEqual({ kind: 'accepted' })
      }
      for (const session of net.sessions) expect(session.pending.size).toBe(0)
      console.log(
        `Offline CRDT-direct equality: adapter=${adapter}; effects=${effects}; ${changes} edits/group; ${edits.length} total; ${losing.length} unchanged losing-branch envelopes replayed; four peers; zero rejected/blocked/pending`,
      )
    },
    stress ? 600_000 : 120_000,
  )
}
