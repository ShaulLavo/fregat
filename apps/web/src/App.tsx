import { SessionNotificationCoordinator } from '@/features/chat-mode/components/session-notification-coordinator'
import { AppContent } from '@/components/app-content'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider'
import { WorkspaceEditPreviewDialog } from '@/features/editor/components/workspace-edit-preview-dialog'
import { WorkspaceEditRecoveryDialog } from '@/features/editor/components/workspace-edit-recovery-dialog'

export function App() {
  return (
    <>
      <ChatProviderSignInProvider>
        <AppContent />
      </ChatProviderSignInProvider>
      <SessionNotificationCoordinator />
      <WorkspaceEditPreviewDialog />
      <WorkspaceEditRecoveryDialog />
    </>
  )
}
