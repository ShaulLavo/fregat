import { readFilePreview } from '@workspace/client-core/files/read'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import type { EditTextRequest } from '@/host/providers/actions-context'
import { externalEditorExecutable } from '@/host/external-editor'
import { createTuiError } from '@/host/utils/structured-errors'
import { commitFileEdit } from '@/viewer/state/edit'
import { createViewerDraftCache, type ViewerDraft } from '@/viewer/state/drafts'

type FileSnapshot = Awaited<ReturnType<typeof readFilePreview>>
export type ViewerDocument =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'ready'
      readonly file: FileSnapshot
      readonly editing: boolean
      readonly draft: ViewerDraft | null
      readonly error: string | null
    }

export function createViewerDocument({
  session,
  rootPath,
  path,
  editText,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly path: string
  readonly editText?: (request: EditTextRequest) => Promise<string>
}) {
  const sessionState = session.getSnapshot()
  if (sessionState.kind !== 'ready')
    throw createTuiError(
      'Viewer state is unavailable.',
      'Connect to the server before opening a file.',
    )
  const drafts = createViewerDraftCache(sessionState.storage, rootPath, path)
  const lifetime = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, session.signal])
  const listeners = new Set<() => void>()
  let state: ViewerDocument = { kind: 'loading' }
  const publish = (next: ViewerDocument) => {
    if (signal.aborted) return
    state = next
    for (const listener of listeners) listener()
  }
  async function load(discardDraft: boolean) {
    if (state.kind === 'ready' && state.editing) return
    const previousDraft = state.kind === 'ready' ? state.draft : null
    publish({ kind: 'loading' })
    try {
      if (discardDraft) await drafts.remove(previousDraft)
      const file = await readFilePreview({ client: session.client, path, signal })
      const draft = drafts.read()
      publish({
        kind: 'ready',
        file,
        draft,
        editing: false,
        error: draft
          ? 'An unsaved external-editor draft was restored. Its original file snapshot is still required. Edit to recover it, or discard and reload.'
          : null,
      })
    } catch (error) {
      publish({ kind: 'failed', message: connectionFailure(error).message })
    }
  }
  async function edit() {
    if (state.kind !== 'ready' || state.editing || signal.aborted) return
    const snapshot = state
    publish({ ...snapshot, editing: true, error: null })
    let draft = snapshot.draft
    try {
      if (!editText)
        throw createTuiError(
          'External editor is unavailable.',
          'Use an interactive terminal to edit this file.',
        )
      const sessionState = session.getSnapshot()
      const configured =
        sessionState.kind === 'ready'
          ? sessionState.owner.readSettingsMirror()['editor.externalEditor']
          : ''
      const text = await editText({
        text: draft?.text ?? snapshot.file.content,
        executable: externalEditorExecutable(configured),
        filename: path.split('/').at(-1),
        signal,
      })
      signal.throwIfAborted()
      if (text === snapshot.file.content) {
        await drafts.remove(draft)
        publish({ ...snapshot, editing: false, draft: null })
        return
      }
      draft = {
        text,
        expected: draft?.expected ?? {
          mtimeMs: snapshot.file.mtimeMs,
          version: snapshot.file.version,
        },
      }
      await drafts.save(draft)
      signal.throwIfAborted()
      publish({ ...snapshot, editing: true, draft, error: null })
      await commitFileEdit({
        client: session.client,
        rootPath,
        path,
        content: draft.text,
        snapshot: draft.expected,
        signal,
      })
      await drafts.remove(draft)
      draft = null
      const file = await readFilePreview({ client: session.client, path, signal })
      publish({ kind: 'ready', file, editing: false, draft: null, error: null })
      session.record({ area: 'tui.viewer.edit', path, outcome: 'saved' })
    } catch (error) {
      const message = connectionFailure(error).message
      publish({
        ...snapshot,
        editing: false,
        draft,
        error: draft
          ? `${message} Draft kept. Edit again to recover it, or reload to discard it.`
          : message,
      })
      session.record({ area: 'tui.viewer.edit', path, outcome: 'failed', error: message })
    }
  }
  return {
    open: () => load(false),
    reload: () => load(true),
    edit,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      lifetime.abort()
      listeners.clear()
    },
  }
}
