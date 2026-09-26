import { createObservableStore } from '@/host/state/observable-store'
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

  const store = createObservableStore<RawEditorState>(
    {
      phase: 'idle',
      ...document(owner.getSnapshot().snapshot, target),
      error: null,
    },
    { signal: signal },
  )
  const publish = store.replace
  const edit = async (reload = false) => {
    if (signal.aborted || store.value.phase === 'editing' || store.value.phase === 'saving') return
    publish({ ...store.value, phase: 'editing', error: null })
    try {
      if (reload) publish({ ...store.value, ...document(await owner.refresh(signal), target) })
      const text = await editText({
        text: store.value.text,
        signal,
      })
      signal.throwIfAborted()
      if (text === null) {
        publish({ ...store.value, phase: 'done' })
        return
      }
      publish({ ...store.value, phase: 'saving', text })
      await owner.writeRaw(target, text, store.value.revision, signal)
      publish({ ...store.value, phase: 'done' })
    } catch (error) {
      const conflict = errorStringField(error, 'code') === 'settings.RAW_REVISION_STALE'
      publish({
        ...store.value,
        phase: 'failed',
        error: conflict
          ? 'Settings changed elsewhere. Draft kept. Discard and reload to edit current settings.'
          : (errorStringField(error, 'message') ??
            'Settings could not be saved. Your draft is kept.'),
      })
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    edit,
    dispose() {
      controller.abort()
      store.dispose()
    },
  }
}

function document(snapshot: SettingsSnapshot, target: SettingsWriteTarget) {
  const file = snapshot.layers.find((layer) => layer.id === target)?.file
  return { text: file?.text || '{\n}\n', revision: file?.revision ?? '' }
}
