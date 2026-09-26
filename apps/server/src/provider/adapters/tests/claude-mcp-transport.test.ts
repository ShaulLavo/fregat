import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { FakeClaudeQuery, signedInClaudeAuth } from '../../../../test/factories/fake-claude-query'
import { SYNTHETIC_OPUS, FAKE_CLAUDE_EXECUTABLE } from '../../../../test/factories/claude-models'
import { ClaudeProviderAdapter } from '../claude'

it('keeps the MCP bearer out of real SDK argv and debug logs, delivering it over IPC', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-mcp-transport-'))
  const capture = path.join(root, 'ipc.json')
  vi.stubEnv('CLAUDE_CONFIG_DIR', root)
  vi.stubEnv('DEBUG_CLAUDE_AGENT_SDK', '1')
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const argv: string[][] = []
  const token = 'fixture-private-mcp-token'
  const adapter = new ClaudeProviderAdapter({
    attachmentsDir: root,
    auth: signedInClaudeAuth(),
    resolveExecutable: async () => ({
      ...FAKE_CLAUDE_EXECUTABLE,
      path: path.resolve(import.meta.dirname, '../../../../test/factories/claude-ipc.cjs'),
    }),
    createQuery: (input) => {
      if (input.options.strictMcpConfig) return new FakeClaudeQuery() as unknown as Query
      return query({
        ...input,
        options: {
          ...input.options,
          env: { ...process.env, FAKE_CLAUDE_IPC_CAPTURE: capture },
          spawnClaudeCodeProcess: (options) => {
            expect([options.command, ...options.args].join(' ')).toContain('claude-ipc.cjs')
            argv.push(options.args)
            return input.options.spawnClaudeCodeProcess!(options)
          },
        },
      })
    },
  })
  try {
    await adapter.startRuntime({
      cwd: root,
      modelSelection: {
        model: SYNTHETIC_OPUS,
        providerInstanceId: DEFAULT_CLAUDE_PROVIDER_SETTINGS.id,
      },
      providerInstanceId: DEFAULT_CLAUDE_PROVIDER_SETTINGS.id,
      platformMcp: { token, url: 'http://127.0.0.1:39087/mcp' },
      runtimeMode: 'approval-required',
      runtimeEpoch: 'epoch-1',
      sessionId: v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc'),
    })
    expect(argv).toHaveLength(1)
    expect(JSON.stringify(argv)).not.toContain(token)
    expect(await readFile(capture, 'utf8')).toContain(`Bearer ${token}`)
    const debugDir = path.join(root, 'debug')
    await expect.poll(async () => (await readdir(debugDir)).length).toBeGreaterThan(0)
    const logs = await Promise.all(
      (await readdir(debugDir)).map((file) => readFile(path.join(debugDir, file), 'utf8')),
    )
    expect(logs.join('\n')).toContain('Spawning Claude Code')
    expect(logs.join('\n')).not.toContain(token)
  } finally {
    await adapter.stopAll()
    vi.unstubAllEnvs()
    await rm(root, { force: true, recursive: true })
  }
})
