import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'
import { typePrompt, waitForReply } from './chat-verification'
import { runInFixtureRepository } from './fixture-repository'
import type { FixtureProviderKind, NativeProvider } from './native-provider-verification'

const DONE = 'TOOLS_READY'

/** A stdio MCP server that answers the handshake and lists no tools. */
const FIXTURE_SERVER = `
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const result =
      message.method === 'initialize'
        ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
        : message.method === 'tools/list'
          ? { tools: [] }
          : {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  }
})
`

type SessionToolsProvider = {
  readonly name: string
  readonly description: string
  readonly kind: FixtureProviderKind
  /** Writes the provider's project config into the fixture before its first commit. */
  readonly prepare: (fixture: string, native: NativeProvider) => Promise<void>
  readonly check: (
    popover: Locator,
    page: Page,
    step: (label: string) => Promise<void>,
  ) => Promise<void>
}

/** One turn to start the provider, then the header popover read from its live process. */
function sessionToolsScenario(provider: SessionToolsProvider): Scenario {
  return {
    name: provider.name,
    requiresIsolatedServer: true,
    description: provider.description,
    run: (page, { step }) =>
      runInFixtureRepository(page, step, provider, async ({ openSession }) => {
        await openSession('Session tools')
        await typePrompt(page, `Use no tools. Reply with exactly ${DONE}.`)
        await selectors.chatSend(page).click()
        await waitForReply(page, DONE)

        await page.getByRole('button', { name: 'MCP servers and hooks' }).first().click()
        await provider.check(
          page.getByRole('dialog').filter({ hasText: 'MCP servers' }),
          page,
          step,
        )
      }),
  }
}

export const claudeSessionTools = sessionToolsScenario({
  name: 'claude-session-tools',
  description:
    'The Claude fixture in a fixture repository with two project MCP servers, one working and one whose command does not exist: the popover offers each for approval, and once both are approved the fixture starts each as the CLI does and the popover shows Connected and Failed with the error, Reconnect runs, and the hooks section names where Claude keeps hooks. Removes the fixture, session and project.',
  kind: 'claude',
  async prepare(fixture) {
    await writeFile(path.join(fixture, 'fixture-mcp.mjs'), FIXTURE_SERVER)
    await writeFile(
      path.join(fixture, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: { command: 'node', args: [path.join(fixture, 'fixture-mcp.mjs')] },
          broken: { command: 'platform-fixture-missing-mcp-binary' },
        },
      }),
    )
    await mkdir(path.join(fixture, '.claude'), { recursive: true })
    await writeFile(
      path.join(fixture, '.claude', 'settings.json'),
      JSON.stringify({ enableAllProjectMcpServers: true }),
    )
  },
  async check(popover, page, step) {
    // A checkout's .mcp.json servers stay off until the owner approves each; approving restarts the CLI.
    await popover.getByRole('button', { name: 'Approve fixture' }).waitFor({ timeout: 30_000 })
    await settleAnimations(popover)
    await step('servers-await-approval')
    for (const name of ['fixture', 'broken'])
      await popover.getByRole('button', { name: `Approve ${name}` }).click()
    await popover.getByTitle(/^fixture · Connected/).waitFor({ timeout: 30_000 })
    await popover.getByTitle(/^broken · Failed/).waitFor()
    await popover.getByText('Claude Code reads hooks from its settings files.').waitFor()
    await settleAnimations(popover)
    await step('servers-listed')

    const reconnect = page.waitForResponse((response) =>
      response.url().endsWith('/mcp/broken/reconnect'),
    )
    await popover.getByRole('button', { name: 'Reconnect broken' }).click()
    await reconnect
    await popover.getByTitle(/^broken · Failed/).waitFor()
    await step('reconnect-ran')
  },
})

export const codexSessionTools = sessionToolsScenario({
  name: 'codex-session-tools',
  description:
    "The Codex fixture in a fixture repository with one project hook: after a turn the header popover lists the MCP server in the fixture's Codex home with its state and the checkout's configured hook, read through mcpServerStatus/list and hooks/list. Removes the fixture, session and project.",
  kind: 'codex',
  async prepare(fixture, native) {
    await writeFile(
      path.join(native.root, 'config.toml'),
      '[mcp_servers.fixture]\ncommand = "true"\n',
    )
    await mkdir(path.join(fixture, '.codex'), { recursive: true })
    await writeFile(
      path.join(fixture, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }],
        },
      }),
    )
  },
  async check(popover, _page, step) {
    await popover.getByText('preToolUse', { exact: true }).waitFor({ timeout: 15_000 })
    await popover.getByText('Connected').first().waitFor()
    await settleAnimations(popover)
    await step('codex-tools')
  },
})
