import { ChatModeSessionProvider } from '@/features/chat-mode/providers/session-provider'
import { Stack } from '@/features/phone/components/stack'
import { Start } from '@/features/phone/components/start'
import type { ShellProps } from '@/lib/shell/utils/props'

/** The phone's own composition of the chat features: a stack of screens, not a narrowed workbench. */
export function PhoneShell({ children, rootPath }: ShellProps) {
  if (rootPath === null) return <Start>{children}</Start>
  return (
    <ChatModeSessionProvider editorRootPath={rootPath}>
      <Stack rootPath={rootPath} />
    </ChatModeSessionProvider>
  )
}
