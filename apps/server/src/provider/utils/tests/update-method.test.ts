import { describe, expect, it } from 'vitest'
import { providerUpdatePlan } from '../update-method'

const HOME = '/home/dev'

function plan(driverKind: string, realPath: string, commandPath = realPath) {
  return providerUpdatePlan(driverKind, { commandPath, home: HOME, realPath })
}

describe('providerUpdatePlan', () => {
  it('runs the CLI’s own updater for a standalone install', () => {
    expect(
      plan('claude', `${HOME}/.local/share/claude/versions/2.1.0`, `${HOME}/.local/bin/claude`),
    ).toEqual({
      argv: [`${HOME}/.local/bin/claude`, 'update'],
      command: 'claude update',
      lockKey: `native:${HOME}/.local/share/claude/versions/2.1.0`,
      method: 'native',
    })
    expect(plan('codex', '/opt/codex/packages/standalone/bin/codex')).toMatchObject({
      argv: ['/opt/codex/packages/standalone/bin/codex', 'update'],
      method: 'native',
    })
  })

  it('updates a global npm or bun install under the prefix that holds it', () => {
    expect(plan('codex', '/usr/local/lib/node_modules/@openai/codex/bin/codex.js')).toEqual({
      argv: ['npm', 'install', '--global', '--prefix', '/usr/local', '@openai/codex@latest'],
      command: 'npm install --global --prefix /usr/local @openai/codex@latest',
      lockKey: 'npm:/usr/local',
      method: 'npm',
    })
    expect(
      plan('claude', `${HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`),
    ).toMatchObject({
      argv: ['bun', 'add', '--global', '@anthropic-ai/claude-code@latest'],
      method: 'bun',
    })
  })

  it.each([
    ['mise', `${HOME}/.local/share/mise/installs/claude/2.1.282/claude`, 'mise upgrade claude'],
    [
      'homebrew',
      '/opt/homebrew/Caskroom/claude-code/2.1.0/claude',
      'brew upgrade --cask claude-code',
    ],
    ['homebrew', '/opt/homebrew/Cellar/codex/0.157.0/bin/codex', 'brew upgrade codex'],
    ['bundled', '/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude', null],
    ['unknown', '/srv/tools/claude', null],
  ])('leaves a %s install to a person', (method, realPath, command) => {
    const driverKind = realPath.includes('codex') ? 'codex' : 'claude'

    expect(plan(driverKind, realPath)).toMatchObject({ argv: null, command, method })
  })
})
