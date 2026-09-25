import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import { openChat } from './chat-verification'
import { registerFixtureProject, writeSettings } from './native-provider-verification'
import type { Scenario } from './index'

const LABEL = 'Claude import fixture'
const MODEL = 'claude-haiku-4-5'

const historySchema = v.looseObject({
  models: v.array(
    v.looseObject({
      inputTokens: v.number(),
      model: v.string(),
      outputTokens: v.number(),
      turns: v.number(),
    }),
  ),
})

/** Two prompts, the first answered twice over one API response (one row per content block). */
function transcript(sessionId: string, cwd: string) {
  const now = Date.now()
  const at = (seconds: number) => new Date(now - 60_000 + seconds * 1000).toISOString()
  const base = {
    cwd,
    entrypoint: 'cli',
    gitBranch: 'main',
    isSidechain: false,
    sessionId,
    userType: 'external',
    version: '2.1.282',
  }
  const prompt = (uuid: string, parentUuid: string | null, text: string, seconds: number) => ({
    ...base,
    message: { content: text, role: 'user' },
    parentUuid,
    timestamp: at(seconds),
    type: 'user',
    uuid,
  })
  const answer = (uuid: string, parentUuid: string, id: string, seconds: number) => ({
    ...base,
    message: {
      content: [{ text: 'Done.', type: 'text' }],
      id,
      model: MODEL,
      role: 'assistant',
      type: 'message',
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        input_tokens: 1000,
        output_tokens: 500,
      },
    },
    parentUuid,
    requestId: `req-${id}`,
    timestamp: at(seconds),
    type: 'assistant',
    uuid,
  })
  const rows = [
    prompt('u1', null, 'Count the files', 0),
    answer('a1', 'u1', 'msg-1', 1),
    answer('a1b', 'a1', 'msg-1', 2),
    prompt('u2', 'a1b', 'Now count the folders', 10),
    answer('a2', 'u2', 'msg-2', 11),
  ]
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
}

export const claudeUsageImport: Scenario = {
  name: 'claude-usage-import',
  description:
    "Importing a Claude session begun outside Platform brings its spent tokens: a fixture instance's config holds one transcript for a fixture project, Import from Claude Code reads it, and Settings › Usage counts each API response once. No real transcript is read.",
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const base = orchestration.replace(/\/orchestration$/, '')
    const fixture = await realpath(await createGitFixture('claude-usage-import'))
    const configDir = await mkdtemp('/work/tmp/fregat-claude-usage-import-config-')
    try {
      const project = join(configDir, 'projects', fixture.replace(/[^a-zA-Z0-9]/g, '-'))
      await mkdir(project, { recursive: true })
      const sessionId = crypto.randomUUID()
      await writeFile(join(project, `${sessionId}.jsonl`), transcript(sessionId, fixture))
      // This server's state is thrown away after the run.
      await writeSettings(page, base, [
        {
          kind: 'provider.setEnabled',
          providerInstanceId: 'claude-import-fixture',
          enabled: true,
          createIfMissing: { config: { configDir }, displayLabel: LABEL, driverKind: 'claude' },
        },
      ])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await registerFixtureProject(page, orchestration, fixture)

      await page.goto(page.url().replace(/\/chat(?:\?.*)?$/, '/workbench'))
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('import')
      const row = page
        .locator('div')
        .filter({ has: page.getByText(LABEL, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Import from Claude Code' }) })
        .last()
      await row.getByRole('button', { name: 'Import from Claude Code' }).click()
      await page
        .getByRole('status')
        .getByText(/^1 chats imported/)
        .waitFor({ timeout: 30_000 })
      await step('imported')

      const response = await page.request.get(
        `${base}/providers/usage/history?days=7&utcOffsetMinutes=0`,
        {
          headers: { Origin: new URL(page.url()).origin },
        },
      )
      ok(response.ok(), `Usage history returned ${response.status()}`)
      const history = v.parse(historySchema, await response.json())
      const model = history.models.find((entry) => entry.model === MODEL)
      // The first response is written twice, once per content block; it is billed once.
      strictEqual(model?.inputTokens, 2000, 'Input across the two responses')
      strictEqual(model?.outputTokens, 1000, 'Output across the two responses')
      strictEqual(model?.turns, 2, 'One row per prompt')

      await selectors.settingsSearch(page).fill('usage')
      await page.getByText(MODEL).first().waitFor({ timeout: 15_000 })
      await step('usage-page')
    } finally {
      await rm(configDir, { force: true, recursive: true })
      await rm(fixture, { force: true, recursive: true })
    }
  },
}
