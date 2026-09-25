import path from 'node:path'
import type { ProviderUpdateMethod } from '@workspace/contracts'

type UpdatablePackage = {
  /** The npm package the registry reports the latest version of. */
  npm: string
  /** The binary's own updater, for installs made by its standalone installer. */
  nativeInstall: (install: ProviderInstall) => boolean
}

const PACKAGES: Record<string, UpdatablePackage> = {
  claude: {
    npm: '@anthropic-ai/claude-code',
    nativeInstall: ({ commandPath, home, realPath }) =>
      commandPath === path.join(home, '.local', 'bin', 'claude') ||
      realPath.startsWith(path.join(home, '.local', 'share', 'claude') + path.sep),
  },
  codex: {
    npm: '@openai/codex',
    nativeInstall: ({ realPath }) => realPath.includes('/packages/standalone/'),
  },
}

type ProviderInstall = {
  /** The path PATH lookup returned. */
  commandPath: string
  /** The same path with every symlink resolved. */
  realPath: string
  home: string
}

export type ProviderUpdatePlan = {
  method: ProviderUpdateMethod
  /** Runs on the one-click path; null when only a person can update this install. */
  argv: readonly string[] | null
  /** The one-click command, or the one to run by hand. */
  command: string | null
  /** Installs sharing a key share files, so their updates never overlap. */
  lockKey: string
}

export function providerPackage(driverKind: string) {
  return PACKAGES[driverKind]?.npm ?? null
}

/**
 * One click only where the path proves who installed the CLI. A version manager
 * or Homebrew owns its own tree, so those get the command to run by hand.
 */
export function providerUpdatePlan(
  driverKind: string,
  install: ProviderInstall,
): ProviderUpdatePlan {
  const known = PACKAGES[driverKind]
  const { commandPath, realPath } = install
  if (!known) return manualPlan('unknown', null, realPath)
  if (realPath.includes('/node_modules/@anthropic-ai/claude-agent-sdk')) {
    return manualPlan('bundled', null, realPath)
  }
  if (known.nativeInstall(install)) {
    const argv = [commandPath, 'update']
    return {
      ...oneClickPlan('native', argv, `native:${realPath}`),
      command: `${path.basename(commandPath)} update`,
    }
  }

  return packageManagerPlan(known.npm, realPath)
}

function packageManagerPlan(npm: string, realPath: string): ProviderUpdatePlan {
  const mise = /\/mise\/installs\/([^/]+)\//.exec(realPath)?.[1]
  if (mise) return manualPlan('mise', `mise upgrade ${mise}`, realPath)

  const brew = /\/(Cellar|Caskroom)\/([^/]+)\//.exec(realPath)
  if (brew) {
    const cask = brew[1] === 'Caskroom' ? '--cask ' : ''
    return manualPlan('homebrew', `brew upgrade ${cask}${brew[2]}`, realPath)
  }
  if (realPath.includes(`/.bun/install/global/node_modules/${npm}/`)) {
    return manualPlan('bun', `bun add --global ${npm}@latest`, realPath)
  }

  const npmPrefix = realPath.split(`/lib/node_modules/${npm}/`)
  if (npmPrefix.length === 2 && npmPrefix[0]) {
    const prefix = npmPrefix[0]
    return oneClickPlan(
      'npm',
      ['npm', 'install', '--global', '--prefix', prefix, `${npm}@latest`],
      `npm:${prefix}`,
    )
  }

  return manualPlan('unknown', null, realPath)
}

function oneClickPlan(
  method: ProviderUpdateMethod,
  argv: readonly string[],
  lockKey: string,
): ProviderUpdatePlan {
  return { argv, command: argv.join(' '), lockKey, method }
}

function manualPlan(
  method: ProviderUpdateMethod,
  command: string | null,
  realPath: string,
): ProviderUpdatePlan {
  return { argv: null, command, lockKey: `manual:${realPath}`, method }
}
