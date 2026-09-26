import { ChatModeSessionProvider } from '@/features/chat-mode/providers/session-provider'
import { Stack } from '@/features/phone/components/stack'
import type { FilesystemPath } from '@/lib/documents/utils/types'

/** The phone's own composition of the chat features: a stack of screens, not a narrowed workbench. */
export function PhoneShell({ rootPath }: { readonly rootPath: FilesystemPath }) {
  return (
    <ChatModeSessionProvider editorRootPath={rootPath}>
      <Stack rootPath={rootPath} />
    </ChatModeSessionProvider>
  )
}
