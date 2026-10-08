import {
  createPlugin,
  selectionInput,
  type EditorViewSnapshot,
  type EditorInput,
  type EditorPlugin,
} from '@singapore-editor/core/extensions'
import type { Envelope } from '@singapore-editor/collab'
import type { Editor } from '@singapore-editor/core/editor'
import {
  createPieceTableSnapshot,
  snapBatchEditRanges,
  charIdAt,
  locateCharId,
} from '@singapore-editor/textbuffer'
import { CollaborationDocument, type CollaborationDocumentOptions } from './document'
import { Session, type SessionOptions } from './session'
import type { Message } from './protocol'
import { Presence, type CharacterGap } from './presence'
import { PresenceView } from './presence-view'

export interface CollaborationConnection {
  readonly document: CollaborationDocument
  readonly session: Session<Envelope>
  readonly presence?: Presence
}

export interface CollaborationPluginOptions {
  readonly session: CollaborationDocumentOptions & { readonly room: string }
  readonly transport: { readonly send: (peer: string, message: Message<Envelope>) => void }
  readonly presence?: { readonly displayName: string; readonly colour: string }
  readonly timing?: Partial<
    Pick<
      SessionOptions<Envelope>,
      'pulseInterval' | 'suspicionTimeout' | 'dependencyTimeout' | 'historyChunkRecords'
    >
  >
  /** A simulation can drive session.tick itself; browser attachments run a bounded interval. */
  readonly manualClock?: boolean
  readonly onReady?: (connection: CollaborationConnection) => void | (() => void)
}

/** Attaches protocol and history only when installed on a view. */
export function createCollaborationPlugin(options: CollaborationPluginOptions): EditorPlugin {
  return createPlugin({
    name: 'editor.collaboration',
    view(scope) {
      const document = new CollaborationDocument(options.session)
      const participant = document.participant
      const session = new Session({
        peer: options.session.peer,
        room: options.session.room,
        document: options.session.document,
        genesis: document.genesis,
        engine: document,
        send: options.transport.send,
        pulseInterval: 50,
        suspicionTimeout: 1000,
        dependencyTimeout: 10_000,
        historyChunkRecords: 64,
        ...options.timing,
      })
      const documentId = scope.editor.getState().documentId
      const attached = () => scope.editor.getState().documentId === documentId
      let authoring = false
      const unsubscribe = participant.subscribe(({ edits }) => {
        if (authoring || !attached()) return
        scope.reconcile(document.engine.snapshot().buffer, [], { origin: 'remote', edits })
      })
      scope.onDispose(unsubscribe)
      const authored: Envelope[] = []
      const author: Parameters<typeof scope.authorEdits>[0] = (before, edits) => {
        const batch = snapBatchEditRanges(before, edits).toSorted((a, b) => b.from - a.from)
        authoring = true
        if (batch.length > 1) participant.undoManager.beginTransaction()
        try {
          for (const edit of batch) {
            if (edit.from === edit.to && !edit.text) continue
            authored.push(
              participant.local({
                offset: edit.from,
                deleteCount: edit.to - edit.from,
                text: edit.text,
              }),
            )
          }
          return document.engine.snapshot().buffer
        } finally {
          if (batch.length > 1) participant.undoManager.endTransaction()
          authoring = false
        }
      }
      scope.onDidTransaction((event) => {
        if (!attached() || (event.origin !== 'local' && event.origin !== 'view')) return
        // Identity authoring runs before mutation; only committed transactions enter the network.
        for (const envelope of authored.splice(0)) session.submit(envelope)
      })
      scope.onDispose(() => {
        if (!attached()) return
        const text = collaborationBoundaryText(scope.editor)
        scope.reconcile(createPieceTableSnapshot(text), [], { origin: 'replay', edits: [] })
      })
      let commands: { dispose(): void }[] = []
      const bufferInput: EditorInput<object | null> = {
        id: 'collaboration.buffer',
        kinds: [],
        read: (_snapshot, editor) => (editor as Editor).getBufferSession()?.buffer ?? null,
      }
      scope.watch(bufferInput, () => {
        for (const command of commands) command.dispose()
        commands = []
        if (!attached()) return
        for (const direction of ['undo', 'redo'] as const) {
          commands.push(
            scope.handle(direction, () => {
              const edit = participant.undoManager[direction]()
              if (edit) session.submit(edit)
              return true
            }),
          )
        }
        const before = collaborationBoundaryText(scope.editor)
        const after = document.engine.text()
        scope.reconcile(document.engine.snapshot().buffer, [], {
          origin: 'replay',
          edits: before === after ? [] : [{ from: 0, to: before.length, text: after }],
        })
        commands.push(scope.authorEdits(author))
      })
      const presence = options.presence
        ? new Presence(options.session.peer, options.session.document, session)
        : undefined
      if (presence && options.presence) {
        const identity = options.presence
        const resolver = {
          resolveGap(gap: CharacterGap): number | undefined {
            const buffer = document.engine.snapshot().buffer
            const left =
              gap.left === 'start'
                ? { offset: 0, liveness: 'deleted' }
                : locateCharId(buffer, gap.left)
            const right =
              gap.right === 'end' ? { offset: buffer.length } : locateCharId(buffer, gap.right)
            if (!left || !right) return
            return gap.bias === 'left'
              ? left.offset + Number(left.liveness === 'live')
              : right.offset
          },
        }
        const view = new PresenceView(scope.view, { presence, resolver })
        scope.own(view)
        scope.onDispose(() => presence.dispose())
        const publish = () => {
          if (!attached()) {
            presence.leave()
            return
          }
          const buffer = document.engine.snapshot().buffer
          const gap = (offset: number): CharacterGap => ({
            left: offset === 0 ? 'start' : charIdAt(buffer, offset - 1)!,
            right: offset === buffer.length ? 'end' : charIdAt(buffer, offset)!,
            bias: 'right',
          })
          presence.setLocalState({
            ...identity,
            epoch: options.session.epoch,
            tip: document.checkpoint(),
            focusedViewId: scope.view.container.contains(
              scope.view.container.ownerDocument.activeElement,
            )
              ? options.session.peer
              : null,
            selections: scope.getSelections().map(({ anchorOffset, headOffset }) => ({
              anchor: gap(anchorOffset),
              head: gap(headOffset),
            })),
          })
        }
        scope.watch(selectionInput, publish)
        const input: EditorInput<EditorViewSnapshot> = {
          id: 'collaboration.presence-view',
          kinds: ['content', 'viewport', 'layout'],
          read: (snapshot) => snapshot,
        }
        scope.watch(input, (snapshot) => view.update(snapshot, attached() ? 'document' : 'clear'))
        scope.view.container.addEventListener('focusin', publish)
        scope.view.container.addEventListener('focusout', publish)
        scope.onDispose(() => {
          scope.view.container.removeEventListener('focusin', publish)
          scope.view.container.removeEventListener('focusout', publish)
        })
      }
      const cleanup = options.onReady?.({ document, session, presence })
      if (cleanup) scope.onDispose(cleanup)
      if (!options.manualClock) {
        // @justification The protocol needs elapsed time for failure detection; this opt-in
        // clock is configurable, manual in simulations, and cleared when its view detaches.
        const timer = setInterval(
          () => session.tick(performance.now()),
          options.timing?.pulseInterval ?? 50,
        )
        scope.onDispose(() => clearInterval(timer))
      }
    },
  })
}

function collaborationBoundaryText(editor: Pick<Editor, 'getTextSnapshot'>): string {
  return editor.getTextSnapshot().materializeFullText()
}
