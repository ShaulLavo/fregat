import { ReferenceEngine, type CharId } from '@singapore-editor/collab'
import { Presence, type CharacterGap, type GapResolver, type PresenceState } from '../src/presence'
import { Session } from '../src/session'
import { TransportRouter, type TransportKind } from '../src/transport-router'
import type { Message } from '../src/protocol'
import { BrowserEngine, browserGenesis, type BrowserEdit } from './browser-engine'

export function presenceNetwork(suspicionTimeout = 5_000) {
  const packets: { readonly target: number; readonly message: Message<BrowserEdit> }[] = []
  const peers = ['local', 'remote'].map((peer) => {
    let router: TransportRouter<BrowserEdit>
    const session = new Session({
      peer,
      room: 'room',
      document: 'document',
      genesis: browserGenesis,
      engine: new BrowserEngine(),
      send: (target, message) => router.send(target, message),
      pulseInterval: 100,
      suspicionTimeout,
      dependencyTimeout: 500,
      historyChunkRecords: 10,
    })
    router = new TransportRouter({ peer, room: 'room', document: 'document' }, session)
    const presence = new Presence(peer, 'document', session)
    presence.attach()
    return { session, router, presence }
  })
  const flush = () => {
    let delivered = 0
    while (packets.length) {
      if (++delivered > 1_000) throw new RangeError('Presence fixture failed to settle')
      const { target, message } = packets.shift()!
      peers[target]!.router.receive(message.sender, message)
    }
  }
  return {
    peers,
    flush,
    connect(kind: TransportKind = 'webrtc') {
      for (let index = 0; index < peers.length; index++)
        peers[index]!.router.add(peers[1 - index]!.session.peer, kind, (message) =>
          packets.push({ target: 1 - index, message }),
        )
      flush()
    },
    disconnect(kind: TransportKind = 'webrtc') {
      for (let index = 0; index < peers.length; index++)
        peers[index]!.router.remove(peers[1 - index]!.session.peer, kind)
      flush()
    },
    tick(now: number) {
      for (const { session } of peers) session.tick(now)
      flush()
    },
    dispose() {
      for (const { presence } of peers) presence.dispose()
    },
  }
}

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
