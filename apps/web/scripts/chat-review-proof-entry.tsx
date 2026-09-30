import { createBenchmarkError } from './structured-errors.ts'
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
const fixture = await createConnectionNoticeFixture()
const queryClient = createTestQueryClient()
const rootElement = document.getElementById('proof-root')
if (!rootElement) throw createBenchmarkError('Proof root is missing')
const root = createRoot(rootElement)
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
  <AppProviders queryClient={queryClient} connections={fixture.connections}>
    <TestEditorStateProvider>
      <main
        className={
          'bg-background text-foreground mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4'
        }
      >
        <MachineConnectionRows />
        <p className={'text-sm'}>{'Chat is ready.'}</p>
        <section data-proof-search={true}>
          <ActivityRow activity={activity} />
        </section>
        <section data-proof-markdown={true}>
          <AssistantMarkdown
            streaming={false}
            text={'Before ![Result](https://copy-image.test/result.png) after.'}
          />
        </section>
      </main>
    </TestEditorStateProvider>
  </AppProviders>,
)
export const reviewFixes = {
  selectRemote: fixture.selectRemote,
  selectLocal: fixture.selectLocal,
  repeatError: () =>
    fixture.update({ phase: 'blocked', lastError: MACHINE_SETUP_ERROR, lastErrorAt: Date.now() }),
  pending: () => fixture.update({ phase: 'reconnecting', lastError: null }),
  changedError: () =>
    fixture.update({
      phase: 'blocked',
      lastError: {
        code: 'machines.CONNECTION_REFUSED',
        message: 'Connection refused by the remote host.',
      },
      lastErrorAt: Date.now(),
    }),
  copy() {
    const range = document.createRange()
    const markdown = document.querySelector('[data-proof-markdown]')
    if (!markdown) throw createBenchmarkError('Proof markdown is missing')
    range.selectNodeContents(markdown)
    const selection = window.getSelection()
    if (!selection) throw createBenchmarkError('Proof selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    return chatMarkdownClipboardPayload(selection)
  },
}

window.reviewFixes = reviewFixes
