import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const chatStream = isolatedNativeScenario({
  name: 'chat-stream',
  description:
    'Expand a running command and verify its completed output follows the end beyond the detail height cap.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    await selectors.chatMessage(page).fill('Stream the work-log fixture.')
    await selectors.chatSend(page).click()
    await selectors.liveWorkLogToggle(page).click()
    const group = selectors.workLogGroup(page).first()
    await group.waitFor()
    await group.getByRole('button').filter({ hasText: 'STREAM_START' }).click()
    await selectors.workLogOutput(page).filter({ hasText: 'STREAM_START' }).waitFor()
    await step('expanded-running-command')
    await writeFile(join(root, 'stream-start'), 'start')
    const output = selectors.workLogOutput(page).filter({ hasText: 'stream line 90 ' }).first()
    await output.waitFor({ timeout: 10_000 })
    ok(
      await output.evaluate((element) => element.scrollHeight > element.clientHeight),
      'The output exceeds its height cap',
    )
    ok(
      await output.evaluate((element) => element.scrollTop > 0),
      'Completed output follows its growing end',
    )
    await output.scrollIntoViewIfNeeded()
    await step('capped-output-completed')
    await writeFile(join(root, 'stream-finish'), 'finish')
    await selectors
      .chatMessages(page)
      .getByText('WORK_LOG_STREAM_VERIFIED', { exact: true })
      .waitFor({ timeout: 20_000 })
    await step('completed-turn')
  },
})
