import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderCommandCatalog } from '@workspace/contracts'
import type { App } from '../../app'
import { closeTestApps, createTestApp } from '../../../test/server'
import { ClaudeProviderAdapter, type ClaudeCreateQuery } from '../adapters/claude'
import { resolveFakeClaudeExecutable } from '../../../test/factories/claude-models'
import { MockProviderAdapter } from '../adapters/mock'
import { ClaudeAuthRunner, type ClaudeAuthProcess } from '../adapters/utils/claude-auth'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

const CLAUDE_COMMANDS = [
  { aliases: ['stats'], argumentHint: '', description: 'Show token usage', name: 'usage' },
  { argumentHint: '<path>', description: 'Review a file', name: 'review' },
  { argumentHint: '', description: '', name: '   ' },
]

const CLAUDE_SKILLS = [
  { argumentHint: '', description: 'Read and edit PDFs', name: 'pdf' },
  { argumentHint: '', description: 'Review UI code', name: 'anthropic-skills:web-design' },
]

/**
 * Stands in for the CLI the probe would otherwise spawn. It answers exactly the
 * two control requests the listing path makes and records the `cwd` it was
 * launched with, which is the only proof the project directory reached it.
 */
function fakeClaudeCli(cwds: Array<string | undefined>): ClaudeCreateQuery {
  return (input) =>
    ({
      initializationResult: async () => {
        cwds.push(input.options.cwd)
        return { account: {}, commands: CLAUDE_COMMANDS }
      },
      reloadSkills: async () => ({ skills: CLAUDE_SKILLS }),
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
    }) as unknown as Query
}

/** A CLI that answers nothing: the first control request throws, as a dead process does. */
const brokenClaudeCli: ClaudeCreateQuery = () => ({}) as unknown as Query

function neverSpawningAuth() {
  // The catalog read never touches auth, so a spawn here is a bug, not a fixture.
  return new ClaudeAuthRunner({
    spawn: (): ClaudeAuthProcess => expect.unreachable('The catalog read must not run the CLI.'),
  })
}

async function testHarness(createQuery?: ClaudeCreateQuery) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-provider-commands-'))
  roots.push(root)

  const cwds: Array<string | undefined> = []
  const claude = new ClaudeProviderAdapter({
    attachmentsDir: path.join(root, 'attachments'),
    auth: neverSpawningAuth(),
    createQuery: createQuery ?? fakeClaudeCli(cwds),
    resolveExecutable: resolveFakeClaudeExecutable,
  })
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    orchestration: {
      providerAdapterRegistry: new ProviderAdapterRegistry([claude, new MockProviderAdapter()]),
    },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })

  return { app, cwds, root }
}

async function readCatalog(app: App, route: string) {
  const response = await app.handle(
    new Request(`http://local${route}`, { headers: { origin: TRUSTED_ORIGIN } }),
  )

  return { body: (await response.json()) as ProviderCommandCatalog, status: response.status }
}

describe('provider command catalog route', () => {
  it('lists a provider that discovers its own commands and skills', async () => {
    const { app } = await testHarness()
    const result = await readCatalog(app, '/providers/claude/commands')

    expect(result.status).toBe(200)
    expect(result.body.supported).toBe(true)
    // The blank-named entry is dropped: it would fail the contract and take the
    // rest of the catalog down with it.
    expect(result.body.commands).toEqual([
      { aliases: ['stats'], description: 'Show token usage', name: 'usage' },
      { argumentHint: '<path>', description: 'Review a file', name: 'review' },
    ])
    expect(result.body.skills).toEqual([
      { description: 'Read and edit PDFs', enabled: true, name: 'pdf' },
      {
        description: 'Review UI code',
        enabled: true,
        name: 'anthropic-skills:web-design',
        scope: 'anthropic-skills',
      },
    ])
  })

  it('discovers from the project directory the caller asked about', async () => {
    const { app, cwds, root } = await testHarness()
    await readCatalog(app, `/providers/claude/commands?cwd=${encodeURIComponent(root)}`)

    expect(cwds).toEqual([root])
  })

  it('lists a second provider through the same route', async () => {
    const { app } = await testHarness()
    const result = await readCatalog(app, '/providers/codex/commands')

    expect(result.status).toBe(200)
    expect(result.body.supported).toBe(true)
    expect(result.body.commands.map((command) => command.name)).toContain('review')
    expect(result.body.skills.map((skill) => skill.name)).toContain('pdf')
  })

  it('answers an unavailable provider with an empty catalog, not an error', async () => {
    const { app } = await testHarness()
    const result = await readCatalog(app, '/providers/not-a-provider/commands')

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      agents: [],
      commands: [],
      providerInstanceId: 'not-a-provider',
      skills: [],
      supported: false,
    })
  })

  it('answers an empty catalog when the provider probe fails', async () => {
    const { app } = await testHarness(brokenClaudeCli)
    const result = await readCatalog(app, '/providers/claude/commands')

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      agents: [],
      commands: [],
      providerInstanceId: 'claude',
      skills: [],
      supported: false,
    })
  })
})
