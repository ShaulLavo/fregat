import { createEditorTextBuffer } from '@singapore-editor/core/document'
import type { ReactEditorController } from '@singapore-editor/react'
import { renderHook } from '@testing-library/react'
import { describe, vi } from 'vitest'

import { useCommitMessageEditorFocus } from '@/features/editor/hooks/use-commit-message-editor-focus'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { recordTabActivationFocus } from '@/lib/focus/state/tab-activation-focus'
import { expect, test } from '../../../../../test/fixtures'

describe('useCommitMessageEditorFocus', () => {
  test('positions the caret without focusing the editor after a touch tab activation', () => {
    const id = tabId('tab-commit-touch')
    recordTabActivationFocus(id, { shouldFocusEditor: false, origin: 'touch' })

    const setSelection = vi.fn()
    const focus = vi.fn()
    const controller = {
      getEditor: () => ({ focus, setSelection }),
    } as unknown as ReactEditorController
    const document = {
      buffer: createEditorTextBuffer('feat: title\n\nbody\n'),
      target: {
        kind: 'file' as const,
        resource: { kind: 'file' as const, path: filesystemPath('/repo/.git/COMMIT_EDITMSG') },
      },
    }

    renderHook(() => useCommitMessageEditorFocus({ controller, document, tabId: id }))

    expect(setSelection).toHaveBeenCalledWith(12, 12)
    expect(focus).not.toHaveBeenCalled()

    recordTabActivationFocus(id, undefined)
  })

  test('positions the caret and focuses the editor after mouse or keyboard activation', () => {
    const id = tabId('tab-commit-mouse')
    recordTabActivationFocus(id, { shouldFocusEditor: true, origin: 'mouse' })

    const setSelection = vi.fn()
    const focus = vi.fn()
    const controller = {
      getEditor: () => ({ focus, setSelection }),
    } as unknown as ReactEditorController
    const document = {
      buffer: createEditorTextBuffer('feat: title\n\nbody\n'),
      target: {
        kind: 'file' as const,
        resource: { kind: 'file' as const, path: filesystemPath('/repo/.git/COMMIT_EDITMSG') },
      },
    }

    renderHook(() => useCommitMessageEditorFocus({ controller, document, tabId: id }))

    expect(setSelection).toHaveBeenCalledWith(12, 12)
    expect(focus).toHaveBeenCalledTimes(1)

    recordTabActivationFocus(id, undefined)
  })
})
