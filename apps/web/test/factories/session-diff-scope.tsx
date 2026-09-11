import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { ChatModeSessionContext } from '@/features/chat-mode/providers/session-context'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import type { Navigation } from '@/state/navigation'
import { activeSession } from '@/features/chat-mode/utils/active-session'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import type { createRailHarness } from './rail-harness'
import { renderWithProviders } from '../render'

export function renderSessionDiffScope(
  harness: Awaited<ReturnType<typeof createRailHarness>>,
  navigation: Navigation,
) {
  const { selection, restored } = useSessionSelectionStore.getState()
  const context = {
    ...harness.context,
    activeSession: activeSession({
      environmentId: harness.environmentId,
      projectId: harness.projectId,
      selection,
      restored,
      sessionIds: harness.sessionIds,
    }),
  }
  return renderWithProviders(
    <EditorStateProvider runtime={harness.application.getSnapshot().editor}>
      <ChatModeSessionContext value={context}>
        <ScopeProbe />
      </ChatModeSessionContext>
    </EditorStateProvider>,
    {
      application: harness.application,
      navigation,
      queryClient: harness.application.getSnapshot().queryClient,
    },
  )
}

function ScopeProbe() {
  const { scope } = useSessionDiffScope()
  return <output aria-label='Resolved diff scope'>{JSON.stringify(scope)}</output>
}
