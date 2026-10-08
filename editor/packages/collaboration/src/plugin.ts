import {
  createPlugin,
  type EditorInput,
  type EditorPlugin,
} from '@singapore-editor/core/extensions'
import type { Envelope } from '@singapore-editor/collab'
import type { Editor } from '@singapore-editor/core/editor'
import { createPieceTableSnapshot, snapBatchEditRanges } from '@singapore-editor/textbuffer'
import { CollaborationDocument, type CollaborationDocumentOptions } from './document'
import { Session, type SessionOptions } from './session'
import type { Message } from './protocol'

export interface CollaborationConnection {
  readonly document: CollaborationDocument
  readonly session: Session<Envelope>
}

export interface CollaborationPluginOptions {
  readonly session: CollaborationDocumentOptions & { readonly room: string }
  readonly transport: { readonly send: (peer: string, message: Message<Envelope>) => void }
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
      const cleanup = options.onReady?.({ document, session })
      if (cleanup) scope.onDispose(cleanup)
      if (!options.manualClock) {
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
