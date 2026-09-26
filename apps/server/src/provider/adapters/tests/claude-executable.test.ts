import { describe, expect, it } from 'vitest'
import { parseCliVersion } from '../../utils/cli-version'
import {
  resolveClaudeExecutable,
  type ClaudeExecutable,
  type ClaudeExecutableProbe,
} from '../utils/claude-executable'

const BUNDLED: ClaudeExecutable = { path: '/sdk/claude', source: 'bundled', version: '2.1.10' }
const INSTALLED_PATH = '/usr/local/bin/claude'

function probe(overrides: {
  bundled?: ClaudeExecutable | null
  installed?: string | null
  versions?: Readonly<Record<string, string | null>>
}): ClaudeExecutableProbe {
  const installed = overrides.installed === undefined ? INSTALLED_PATH : overrides.installed

  return {
    bundled: () => (overrides.bundled === undefined ? BUNDLED : overrides.bundled),
    version: async (executablePath) => overrides.versions?.[executablePath] ?? null,
    which: (command) => {
      if (command === 'claude') return installed
      return command.startsWith('/present/') ? command : null
    },
  }
}

describe('resolveClaudeExecutable', () => {
  it('runs the installed CLI when it is at least as new as the bundled one', async () => {
    const executable = await resolveClaudeExecutable({
      env: {},
      probe: probe({ versions: { [INSTALLED_PATH]: '2.1.10' } }),
    })

    expect(executable).toEqual({ path: INSTALLED_PATH, source: 'installed', version: '2.1.10' })
  })

  it('compares versions numerically, not as text', async () => {
    const executable = await resolveClaudeExecutable({
      env: {},
      probe: probe({ versions: { [INSTALLED_PATH]: '2.1.9' } }),
    })

    expect(executable).toEqual(BUNDLED)
  })

  it('runs the bundled CLI when the installed one cannot state its version', async () => {
    const executable = await resolveClaudeExecutable({ env: {}, probe: probe({}) })

    expect(executable).toEqual(BUNDLED)
  })

  it('runs the bundled CLI when none is installed', async () => {
    const executable = await resolveClaudeExecutable({ env: {}, probe: probe({ installed: null }) })

    expect(executable).toEqual(BUNDLED)
  })

  it('reports not installed when there is neither an installed nor a bundled CLI', async () => {
    await expect(
      resolveClaudeExecutable({ env: {}, probe: probe({ bundled: null, installed: null }) }),
    ).rejects.toMatchObject({ code: 'provider.NOT_INSTALLED' })
  })

  it('runs a configured binary at or above the bundled version', async () => {
    const executable = await resolveClaudeExecutable({
      binaryPath: '/present/claude',
      env: {},
      probe: probe({ versions: { '/present/claude': '2.1.12' } }),
    })

    expect(executable).toEqual({ path: '/present/claude', source: 'configured', version: '2.1.12' })
  })

  it('reports a configured binary older than the bundled one as unsupported', async () => {
    await expect(
      resolveClaudeExecutable({
        binaryPath: '/present/claude',
        env: {},
        probe: probe({ versions: { '/present/claude': '1.0.0' } }),
      }),
    ).rejects.toMatchObject({
      code: 'provider.CLAUDE_CLI_TOO_OLD',
      message: 'Claude Code 1.0.0 is older than the minimum 2.1.10',
    })
  })

  it('fails on a configured binary that does not exist', async () => {
    await expect(
      resolveClaudeExecutable({ binaryPath: '/missing/claude', env: {}, probe: probe({}) }),
    ).rejects.toMatchObject({ fix: expect.stringContaining('provider settings') })
  })
})

describe('parseCliVersion', () => {
  it('reads the version out of `claude --version`', () => {
    expect(parseCliVersion('2.1.281 (Claude Code)\n')).toBe('2.1.281')
    expect(parseCliVersion('command not found')).toBeNull()
  })
})
