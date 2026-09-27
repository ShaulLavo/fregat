import { DeferredTerminalPanel } from '@/features/terminal/components/deferred-panel'
import { useSessionTerminalId } from '@/features/chat-mode/hooks/use-session-terminal-id'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import { KeepAliveSlot } from '@/lib/keep-alive/components/keep-alive-slot'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

/** The active session's shell, the same PTY in every shell and pane that shows it. */
export function SessionTerminal() {
  const toolRoot = useSessionToolRoot()
  const terminalSessionId = useSessionTerminalId()

  return (
    // Kept, so another tool, a collapsed pane or another session never ends this shell.
    <KeepAliveSlot id={`chat-terminals:${terminalSessionId}`} scope='chat-terminals'>
      {(attached) => (
        <RenderErrorBoundary label='Terminal'>
          <DeferredTerminalPanel
            active={attached}
            className='h-full'
            rootPath={toolRoot}
            sessionId={terminalSessionId}
          />
        </RenderErrorBoundary>
      )}
    </KeepAliveSlot>
  )
}
