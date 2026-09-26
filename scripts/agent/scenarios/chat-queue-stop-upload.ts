import { ok, strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { control, enqueue, expectQueued, until, waitForInputs } from './chat-queue'
import {
  isolatedNativeScenario,
  nativeLog,
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

/**
 * Plan 126 INTERACTION-01: Stop while a file is still uploading restores the queued follow-up
 * exactly once, before the interrupt answers, and the upload finishes into the same draft.
 */
export const chatQueueStopUpload = isolatedNativeScenario({
  name: 'chat-queue-stop-upload',
  description:
    'Queue a follow-up, start a file upload the network holds, and press Stop: the follow-up is back in the composer once while the interrupt is still pending, the held upload then lands on the same draft, and nothing reaches the provider.',
  fixture: new URL('../fixtures/native-queue.mjs', import.meta.url),
  async drive(page, { step, root, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const release = Promise.withResolvers<void>()
    try {
      await writeSettings(page, base, [{ kind: 'reset', keys: ['chat.followUpBehavior'] }])
      await selectors.chatMessage(page).fill('QUEUE_START')
      await selectors.chatSend(page).click()
      await waitForInputs(root, 1)
      await enqueue(page, 'QUEUE_BEFORE_STOP')
      await expectQueued(page, 1)

      await page.route('**/attachments/uploads/**', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback()
        await release.promise
        return route.fallback()
      })
      await selectors.chatComposerFileInput(page).setInputFiles({
        name: 'slow.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('held upload\n'),
      })
      await page.getByRole('status').getByText('Preparing attachments…').waitFor()
      await step('upload-held-with-follow-up-queued')

      await selectors.chatStop(page).click()
      await expectQueued(page, 0)
      await until(
        async () => (await nativeLog(root)).some((entry) => entry.event === 'interrupt-requested'),
        'The interrupt is pending',
      )
      const restored = (await selectors.chatMessage(page).textContent()) ?? ''
      strictEqual(restored.split('QUEUE_BEFORE_STOP').length - 1, 1, 'Restored exactly once')
      await step('stop-restores-once-while-uploading')

      release.resolve()
      await selectors.chatStagedFile(page, 'slow.txt').waitFor()
      await page
        .getByRole('status')
        .getByText('Preparing attachments…')
        .waitFor({ state: 'detached' })
      strictEqual(await selectors.chatMessage(page).textContent(), restored)
      await control(root, 'reject-interrupt')
      await Bun.sleep(200)
      strictEqual(await selectors.chatMessage(page).textContent(), restored)
      strictEqual((await nativeLog(root)).filter((entry) => entry.event === 'turn/steer').length, 0)
      ok((await selectors.chatSendQueued(page).count()) === 0, 'Nothing is queued again')
      await step('upload-lands-on-the-restored-draft')
      await control(root, 'complete')
    } finally {
      release.resolve()
      await page.unroute('**/attachments/uploads/**')
      await restoreUserSettings(page, base, before, ['chat.followUpBehavior'])
    }
  },
})
