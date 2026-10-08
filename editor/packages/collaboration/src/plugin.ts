import {
  createPlugin,
  selectionInput,
  type EditorViewSnapshot,
  type EditorInput,
  type EditorPlugin,
  type DocumentEditAuthor,
} from '@singapore-editor/core/extensions'
import { CollabFailure, TextbufferEngine, type Envelope } from '@singapore-editor/collab'
import type { Editor } from '@singapore-editor/core/editor'
import {
  createPieceTableSnapshot,
  diffPieceTableSnapshots,
  materializePieceTableFullText,
  snapBatchEditRanges,
  readPieceTableTextRange,
  type PieceTableSnapshot,
  type PieceTableEdit,
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
      let recoverHistory = false
      const document = new CollaborationDocument(options.session, {
        captureOnly: true,
        onReject: (ids) => {
          if (ids.some((id) => id.actor === options.session.peer)) recoverHistory = true
        },
      })
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
      let timer: ReturnType<typeof setInterval> | undefined
      let authoring = false
      const authored: Envelope[] = []
      const author: Parameters<typeof scope.authorEdits>[0] = Object.assign(
        (
          before: PieceTableSnapshot,
          edits: readonly PieceTableEdit[],
          capture?: { readonly history?: 'record' | 'skip' },
        ) => {
          const batch = identityEdits(before, edits)
            .filter((edit) => edit.from !== edit.to || edit.text)
            .toSorted((a, b) => b.from - a.from || b.to - a.to)
          authoring = true
          try {
            const envelopes = participant.localBatch(
              batch.map((edit) => ({
                offset: edit.from,
                deleteCount: edit.to - edit.from,
                text: edit.text,
              })),
              { history: capture?.history !== 'skip' },
            )
            authored.push(...envelopes)
            return document.engine.snapshot().buffer
          } finally {
            authoring = false
          }
        },
        {
          history: {
            capture: () => participant.undoManager.lastRecordedTransaction,
            settlement: () => {
              if (!recoverHistory) return null
              recoverHistory = false
              return document.authoredEffects()
            },
            seal: () => participant.undoManager.seal(),
            identity: () => document.historyIdentity(),
            matchesIdentity: (saved) => document.matchesHistoryIdentity(saved),
            preview: (changes) => {
              if (changes.length === 0) return document.engine.snapshot().buffer
              const engine = new TextbufferEngine()
              engine.restore(document.engine.snapshot())
              const id = { actor: options.session.peer, seq: Number.MAX_SAFE_INTEGER }
              engine.apply({
                document: options.session.document,
                epoch: options.session.epoch,
                id,
                lamport: 0,
                deps: [],
                change: {
                  kind: 'setEffects',
                  command: id,
                  effects: changes.flatMap(({ transaction, active }) =>
                    transaction.edits.map((op) => ({ op, active })),
                  ),
                },
              })
              return engine.snapshot().buffer
            },
            apply: (changes) => {
              authoring = true
              try {
                const command = participant.undoManager.setTransactions(changes)
                session.submit(command)
                return document.engine.snapshot().buffer
              } finally {
                authoring = false
              }
            },
          } satisfies NonNullable<DocumentEditAuthor['history']>,
        },
      )
      // Claim the document before any bootstrap reconciliation can mutate a shared buffer.
      const registration = scope.authorEdits(author)
      const buffer = scope.editor.getBufferSession()!.buffer
      const attached = () => scope.editor.getBufferSession()?.buffer === buffer
      const unsubscribe = participant.subscribe(({ edits }) => {
        if (authoring || !attached()) return
        scope.reconcile(document.engine.snapshot().buffer, [], { origin: 'remote', edits })
      })
      scope.onDispose(unsubscribe)
      scope.onDidTransaction((event) => {
        if (!attached() || (event.origin !== 'local' && event.origin !== 'view')) return
        // Identity authoring runs before mutation; only committed transactions enter the network.
        for (const envelope of authored.splice(0)) session.submit(envelope)
      })
      let detached = false
      const detach = () => {
        if (detached) return
        detached = true
        clearInterval(timer)
        unsubscribe()
        registration.dispose()
        // A leased view may still show an older snapshot than the confirmed engine state.
        const text = collaborationBoundaryText(document.engine.snapshot().buffer)
        const snapshot = createPieceTableSnapshot(text)
        const edit = diffPieceTableSnapshots(buffer.getSnapshot(), snapshot)
        buffer.reconcile(snapshot, [], { origin: 'replay', edits: edit ? [edit] : [] })
        session.leave()
      }
      scope.onDispose(detach)
      const bufferInput: EditorInput<object | null> = {
        id: 'collaboration.buffer',
        kinds: [],
        read: (_snapshot, editor) => (editor as Editor).getBufferSession()?.buffer ?? null,
      }
      scope.watch(bufferInput, () => {
        if (!attached()) detach()
      })
      const before = collaborationBoundaryText(buffer.getSnapshot())
      const after = document.engine.text()
      scope.reconcile(document.engine.snapshot().buffer, [], {
        origin: 'replay',
        edits: before === after ? [] : [{ from: 0, to: before.length, text: after }],
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
      if (!options.manualClock && !detached) {
        // @justification The protocol needs elapsed time for failure detection; this opt-in
        // clock is configurable, manual in simulations, and cleared when its view detaches.
        timer = setInterval(
          () => session.tick(performance.now()),
          options.timing?.pulseInterval ?? 50,
        )
        scope.onDispose(() => clearInterval(timer))
      }
    },
  })
}

function collaborationBoundaryText(snapshot: PieceTableSnapshot): string {
  return materializePieceTableFullText(snapshot)
}

// Native edits may repair one half of a surrogate pair. Identity edits must name the whole pair.
function identityEdits(
  before: PieceTableSnapshot,
  edits: readonly PieceTableEdit[],
): readonly PieceTableEdit[] {
  const groups: { from: number; to: number; edits: PieceTableEdit[] }[] = []
  for (const edit of snapBatchEditRanges(before, edits)) {
    const from = edit.from - Number(pairSeam(before, edit.from))
    const to = edit.to + Number(pairSeam(before, edit.to))
    const previous = groups.at(-1)
    if (previous && from < previous.to) {
      previous.to = Math.max(previous.to, to)
      previous.edits.push(edit)
      continue
    }
    groups.push({ from, to, edits: [edit] })
  }
  return groups.map((group) => {
    let cursor = group.from
    let text = ''
    for (const edit of group.edits) {
      text += readPieceTableTextRange(before, cursor, edit.from) + edit.text
      cursor = edit.to
    }
    text += readPieceTableTextRange(before, cursor, group.to)
    if (/[\ud800-\udfff]/u.test(text)) throw new CollabFailure('split-surrogate')
    return { from: group.from, to: group.to, text }
  })
}

function pairSeam(before: PieceTableSnapshot, offset: number): boolean {
  if (offset === 0 || offset === before.length || !before.buffers.containsSurrogates) return false
  return readPieceTableTextRange(before, offset - 1, offset + 1).codePointAt(0)! > 0xffff
}
