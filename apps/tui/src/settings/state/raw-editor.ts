import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import {
  errorStringField,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from '@workspace/contracts'

import type { EditTextRequest } from '@/host/providers/actions-context'

type RawEditorState = {
  readonly phase: 'idle' | 'editing' | 'saving' | 'failed' | 'done'
  readonly text: string
  readonly revision: string
  readonly error: string | null
}

export function createRawSettingsEditor({
  owner,
  target,
  editText,
  signal: parentSignal,
}: {
  readonly owner: SettingsOwner
  readonly target: SettingsWriteTarget
  readonly editText: (request: EditTextRequest) => Promise<string | null>
  readonly signal?: AbortSignal
}) {
  const controller = new AbortController()
  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal
  const listeners = new Set<() => void>()
  let state: RawEditorState = {
    phase: 'idle',
    ...document(owner.getSnapshot().snapshot, target),
    error: null,
  }
  const publish = (next: RawEditorState) => {
    if (signal.aborted) return
    state = next
    for (const listener of listeners) listener()
  }
  const edit = async (reload = false) => {
    if (signal.aborted || state.phase === 'editing' || state.phase === 'saving') return
    publish({ ...state, phase: 'editing', error: null })
    try {
      if (reload) publish({ ...state, ...document(await owner.refresh(signal), target) })
      const text = await editText({
        text: state.text,
        signal,
      })
      signal.throwIfAborted()
      if (text === null) {
        publish({ ...state, phase: 'done' })
        return
      }
      publish({ ...state, phase: 'saving', text })
      await owner.writeRaw(target, text, state.revision, signal)
      publish({ ...state, phase: 'done' })
    } catch (error) {
      const conflict = errorStringField(error, 'code') === 'settings.RAW_REVISION_STALE'
      publish({
        ...state,
        phase: 'failed',
        error: conflict
          ? 'Settings changed elsewhere. Draft kept. Discard and reload to edit current settings.'
          : (errorStringField(error, 'message') ??
            'Settings could not be saved. Your draft is kept.'),
      })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    edit,
    dispose() {
      controller.abort()
      listeners.clear()
    },
  }
}

function document(snapshot: SettingsSnapshot, target: SettingsWriteTarget) {
  const file = snapshot.layers.find((layer) => layer.id === target)?.file
  return { text: file?.text || '{\n}\n', revision: file?.revision ?? '' }
}
