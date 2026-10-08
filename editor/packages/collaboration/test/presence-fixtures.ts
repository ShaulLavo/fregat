import { ReferenceEngine, type CharId } from '@singapore-editor/collab'
import type { CharacterGap, GapResolver, PresenceState } from '../src/presence'

export function remoteState(peer = 'remote', clock = 1): PresenceState {
  return {
    peerSessionId: peer,
    presenceClock: clock,
    documentId: 'document',
    epoch: 'epoch',
    tip: { depth: 0, hash: 'genesis' },
    displayName: 'Ada',
    colour: '#3775c5',
    focusedViewId: 'remote-view',
    selections: [],
  }
}

export class ReferenceResolver implements GapResolver {
  readonly engine = new ReferenceEngine()

  constructor(text: string) {
    this.engine.apply({
      document: 'document',
      epoch: 'epoch',
      id: { actor: 'seed', seq: 0 },
      lamport: 0,
      deps: [],
      change: {
        kind: 'insert',
        start: { bunch: 'seed:0', counter: 0 },
        originLeft: 'start',
        originRight: 'end',
        text,
      },
    })
  }

  gap(offset: number, bias: CharacterGap['bias'] = 'right'): CharacterGap {
    const origins = this.engine.origins(offset)
    return { left: origins.originLeft, right: origins.originRight, bias }
  }

  resolveGap(gap: CharacterGap): number | undefined {
    const left = gap.left === 'start' ? 0 : this.after(gap.left)
    const right =
      gap.right === 'end'
        ? this.engine.text().length
        : (this.engine.visibleOffset(gap.right) ?? undefined)
    if (left === undefined || right === undefined) return
    return gap.bias === 'left' ? left : right
  }

  private after(id: CharId): number | undefined {
    const offset = this.engine.visibleOffset(id)
    if (offset === null) return
    const node = this.engine
      .snapshot()
      .nodes.find((node) => node.id.bunch === id.bunch && node.id.counter === id.counter)
    return offset + Number(!node?.deleted)
  }
}
