import { createCheckpointRevertCommand } from '@workspace/client-core/chat/commands'
import { awaitRewind, prepareRewindAttachments } from '@/features/chat/utils/rewind'
import { test, expect } from '../../../../../test/fixtures'
import {
  makeSessionDomainFixture,
  DOMAIN_SESSION,
} from '../../../../../test/factories/session-domain'
import { unsupportedChatTransport } from '../../../../../test/factories/chat-transport'

test.each([false, true])(
  'waits for the real engine result, restoreFiles=%s',
  async (restoreFiles) => {
    const fixture = await makeSessionDomainFixture({ providerRuntime: true })
    try {
      const registration = await fixture.register()
      await fixture.createSession(registration.result!.worktreeId)
      await fixture.startTurn()
      await fixture.engine.providerRuntimeIdle()
      const before = await fixture.engine.sessionDetailSnapshot(DOMAIN_SESSION)
      const command = createCheckpointRevertCommand({
        sessionId: DOMAIN_SESSION,
        turnCount: 0,
        restoreFiles,
      })
      const accepted = await fixture.dispatch(command)
      const transport = unsupportedChatTransport({
        replayEvents: (input) => fixture.engine.replay(input),
        sessionDetailStream: async function* (sessionId, input) {
          for await (const item of fixture.engine.sessionDetailStream(sessionId, input)) {
            if (item.kind !== 'synchronized') yield item
          }
        },
      })
      if (restoreFiles) {
        await expect(awaitRewind(transport, command, accepted.sequence)).rejects.toThrow(
          'isolated worktree',
        )
        expect(
          (await fixture.engine.sessionDetailSnapshot(DOMAIN_SESSION)).session.messages,
        ).toEqual(before.session.messages)
        return
      }
      const completion = await awaitRewind(transport, command, accepted.sequence)
      expect(completion.correlationId).toBe(command.commandId)
      expect((await fixture.engine.sessionDetailSnapshot(DOMAIN_SESSION)).session.messages).toEqual(
        [],
      )
      const message = before.session.messages.find((entry) => entry.role === 'user')!
      await expect(
        prepareRewindAttachments(
          {
            ...message,
            attachments: [
              {
                id: 'image',
                name: 'image.png',
                type: 'image',
                mimeType: 'image/png',
                sizeBytes: 1,
              },
            ],
          },
          'https://unused.invalid',
          8,
        ),
      ).rejects.toThrow('limit')
    } finally {
      await fixture.server.cleanup()
    }
  },
)
