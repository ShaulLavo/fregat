import { Editor } from '@singapore-editor/core/editor'
import { createCollaborationPlugin, type CollaborationConnection } from '../src/plugin'
import type { Envelope } from '@singapore-editor/collab'
import type { Message } from '../src/protocol'
import type { MergeReviewOptions } from '../src/review'

export class EditorRoom {
  readonly editors: Editor[] = []
  readonly connections: CollaborationConnection[] = []
  readonly packets: { readonly to: number; readonly message: Message<Envelope> }[] = []
  readonly alive = new Set<number>()
  readonly host = document.createElement('section')
  clock = 0

  constructor(
    count: number,
    text = '',
    presence = false,
    review?: MergeReviewOptions | ((index: number) => MergeReviewOptions),
  ) {
    this.host.id = 'collaboration-editors'
    this.host.style.cssText = 'display:flex;gap:24px;width:100%;height:420px;'
    document.body.append(this.host)
    for (let index = 0; index < count; index++) {
      const element = document.createElement('div')
      element.id = `collaboration-editor-${index}`
      element.style.cssText = 'flex:1;min-width:0;height:100%;background:#171b22;color:#e1e5eb;'
      this.host.append(element)
      const plugin = createCollaborationPlugin({
        session: {
          peer: `peer-${index}`,
          room: 'test-room',
          document: 'test-document',
          epoch: 'test-epoch',
          text,
        },
        transport: {
          send: (peer, message) => this.packets.push({ to: Number(peer.slice(5)), message }),
        },
        presence: presence ? { displayName: `Peer ${index}`, colour: '#3775c5' } : undefined,
        mergeReview: typeof review === 'function' ? review(index) : review,
        manualClock: true,
        onReady: (connection) => {
          this.connections[index] = connection
        },
      })
      this.editors.push(
        new Editor(element, { defaultText: text, plugins: [plugin], wordWrap: true }),
      )
      this.alive.add(index)
    }
    for (const connection of this.connections)
      for (const peer of this.connections) connection.session.connect(peer.session.peer)
    this.flush()
  }

  flush(rounds = 8): void {
    for (let round = 0; round < rounds; round++) {
      this.clock += 100
      for (const index of this.alive) this.connections[index]!.session.tick(this.clock)
      let remaining = 50_000
      while (this.packets.length && remaining-- > 0) {
        const packet = this.packets.shift()!
        if (this.alive.has(packet.to)) this.connections[packet.to]!.session.receive(packet.message)
      }
      if (remaining <= 0)
        throw new TypeError('Session did not settle within the fixture message bound')
    }
  }

  texts(): readonly string[] {
    return Array.from(this.alive, (index) =>
      this.editors[index]!.getTextSnapshot().materializeFullText(),
    )
  }

  remove(index: number): void {
    this.alive.delete(index)
    for (const other of this.alive) this.connections[other]!.session.disconnect(`peer-${index}`)
  }

  dispose(): void {
    for (const editor of this.editors) editor.dispose()
    this.host.remove()
  }
}
