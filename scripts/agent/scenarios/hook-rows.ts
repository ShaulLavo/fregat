import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { typePrompt, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'

const DONE = 'HOOK_ROW_DONE'
const BLOCK_MESSAGE = 'ls is blocked by the fixture hook'
const HOOK_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `echo '${BLOCK_MESSAGE}' >&2; exit 2` }],
      },
    ],
  },
}

export const claudeHookRows: Scenario = {
  name: 'claude-hook-rows',
  requiresIsolatedServer: true,
  description:
    'The Claude fixture in a disposable repository whose project PreToolUse hook blocks every Bash call: the fixture runs the hook as the CLI does, and the turn shows the blocking hook and its message in the work log. Removes the fixture, session and project.',
  run: (page, { step }) =>
    runInFixtureRepository(
      page,
      step,
      {
        kind: 'claude',
        name: 'claude-hook-rows',
        async prepare(fixture) {
          await mkdir(path.join(fixture, '.claude'), { recursive: true })
          await writeFile(
            path.join(fixture, '.claude', 'settings.json'),
            JSON.stringify(HOOK_SETTINGS),
          )
        },
      },
      async ({ openSession }) => {
        await openSession('Hook rows')
        await typePrompt(
          page,
          `Use the Bash tool to run exactly \`ls\`, once. Do not retry. Then reply with exactly ${DONE}.`,
        )
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)

        const log = selectors.chatMessages(page)
        await log.getByText('PreToolUse:Bash blocked').first().waitFor({ timeout: 15_000 })
        await step('hook-row')
        await log.getByText('PreToolUse:Bash blocked').first().click()
        await log.getByText(BLOCK_MESSAGE).first().waitFor({ timeout: 10_000 })
        await step('hook-output')
      },
    ),
}
