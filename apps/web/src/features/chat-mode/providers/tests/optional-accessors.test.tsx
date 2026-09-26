import { renderHook } from '@testing-library/react'

import {
  useChatModeSession,
  useOptionalChatModeSession,
} from '@/features/chat-mode/providers/session-context'
import {
  useOptionalWorkspaceEditService,
  useWorkspaceEditService,
} from '@/features/editor/providers/workspace-edit-context'
import { expect, test } from '../../../../../test/fixtures'

// The command palette mounts above both providers, so a throwing optional accessor takes it down.
test('optional accessors read null without their provider', () => {
  expect(renderHook(() => useOptionalChatModeSession()).result.current).toBeNull()
  expect(renderHook(() => useOptionalWorkspaceEditService()).result.current).toBeNull()
})

test('required accessors name their provider', () => {
  expect(() => renderHook(() => useChatModeSession())).toThrow(
    'useChatModeSession must be used within ChatModeSessionProvider',
  )
  expect(() => renderHook(() => useWorkspaceEditService())).toThrow(
    'useWorkspaceEditService must be used within WorkspaceEditProvider',
  )
})
