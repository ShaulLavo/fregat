import { act } from '@testing-library/react'
import { test, expect } from '../../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../../test/render'
import {
  makeSessionDomainFixture,
  DOMAIN_SESSION,
} from '../../../../../test/factories/session-domain'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'
import { useCheckpointRewind } from '@/features/chat/hooks/use-checkpoint-rewind'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'

test('rewinds through the hook using confirmed machine identity and restores the captured draft', async () => {
  const fixture = await makeSessionDomainFixture({ providerRuntime: true })
  try {
    useEnvironmentsStore.getState().recordDescriptor(fixture.server.origin, fixture.descriptor)
    const registered = await fixture.register()
    await fixture.createSession(registered.result!.worktreeId)
    await fixture.startTurn()
    await fixture.engine.providerRuntimeIdle()
    const message = (
      await fixture.engine.sessionDetailSnapshot(DOMAIN_SESSION)
    ).session.messages.find((entry) => entry.role === 'user')!
    const transport = unsupportedChatTransport({
      environmentId: fixture.descriptor.environmentId,
      dispatchCommand: fixture.dispatch,
      replayEvents: (input) => fixture.engine.replay(input),
      sessionDetailStream: async function* (sessionId, input) {
        for await (const item of fixture.engine.sessionDetailStream(sessionId, input)) {
          if (item.kind !== 'synchronized') yield item
        }
      },
    })
    const target = {
      environmentId: fixture.descriptor.environmentId,
      draftKey: DOMAIN_SESSION,
      rootPath: fixture.main,
    }
    const drafts = useChatInputDraftStore.getState()
    drafts.setPrompt(target, 'Keep my draft')
    const hook = renderHookWithProviders(() => useCheckpointRewind(transport, DOMAIN_SESSION))
    await act(() =>
      hook.result.current.mutateAsync({ target, message, turnCount: 0, restoreFiles: false }),
    )
    expect(drafts.getDraft(target).prompt).toBe(`${message.text}\n\nKeep my draft`)
    expect((await fixture.engine.sessionDetailSnapshot(DOMAIN_SESSION)).session.messages).toEqual(
      [],
    )
    hook.unmount()
    drafts.clearDraft(target)
  } finally {
    await fixture.server.cleanup()
  }
})
