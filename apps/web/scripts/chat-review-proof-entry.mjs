import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders, createTestQueryClient } from '../test/render.tsx'
import { TestEditorStateProvider } from '../test/factories/editor-state-provider.tsx'
import {
  createConnectionNoticeFixture,
  MACHINE_SETUP_ERROR,
} from '../test/factories/connection-notice.ts'
import { sessionActivity, TEST_ENVIRONMENT_ID } from '../test/factories/chat.ts'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { primaryServerOrigin } from '@/lib/client.ts'
import { useEnvironmentsStore } from '@/lib/environments/state/store.ts'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows.tsx'
import { ActivityRow } from '@/features/chat/components/activity-row.tsx'
import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown.tsx'
import { chatWorkLogEntries } from '@/features/chat/utils/work-log.ts'
import { chatMarkdownClipboardPayload } from '@/features/chat/utils/markdown-clipboard.ts'
import '@workspace/ui/globals.css'

useEnvironmentsStore.getState().recordDescriptor(primaryServerOrigin(), {
  ok: true,
  environmentId: TEST_ENVIRONMENT_ID,
  label: 'Chat review proof',
  protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
  serverVersion: 'proof',
  platform: { os: 'linux', arch: 'x64' },
})
const fixture = createConnectionNoticeFixture()
const queryClient = createTestQueryClient()
const root = createRoot(document.getElementById('proof-root'))
const [activity] = chatWorkLogEntries({
  activities: [
    sessionActivity({
      kind: 'tool.completed',
      tone: 'tool',
      payload: {
        itemType: 'command_execution',
        toolCallId: 'browser-no-match',
        status: 'failed',
        data: {
          command: 'rg absent existing.txt',
          status: 'failed',
          exitCode: 1,
          aggregatedOutput: '',
        },
      },
    }),
  ],
})
root.render(
  React.createElement(
    AppProviders,
    { queryClient, connections: fixture.connections },
    React.createElement(
      TestEditorStateProvider,
      null,
      React.createElement(
        'main',
        {
          className:
            'bg-background text-foreground mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4',
        },
        React.createElement(MachineConnectionRows),
        React.createElement('p', { className: 'text-sm' }, 'Chat is ready.'),
        React.createElement(
          'section',
          { 'data-proof-search': true },
          React.createElement(ActivityRow, { activity }),
        ),
        React.createElement(
          'section',
          { 'data-proof-markdown': true },
          React.createElement(AssistantMarkdown, {
            streaming: false,
            text: 'Before ![Result](https://copy-image.test/result.png) after.',
          }),
        ),
      ),
    ),
  ),
)
window.reviewFixes = {
  selectRemote: fixture.selectRemote,
  selectLocal: fixture.selectLocal,
  repeatError: () =>
    fixture.update({ phase: 'blocked', lastError: MACHINE_SETUP_ERROR, lastErrorAt: Date.now() }),
  pending: () => fixture.update({ phase: 'reconnecting', lastError: null }),
  changedError: () =>
    fixture.update({
      phase: 'blocked',
      lastError: 'Connection refused by the remote host.',
      lastErrorAt: Date.now(),
    }),
  copy() {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('[data-proof-markdown]'))
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return chatMarkdownClipboardPayload(selection)
  },
}
