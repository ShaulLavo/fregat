import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { sessionIdentityErrors } from '../../structured-errors'

const SDK_ENTRY = '@anthropic-ai/claude-agent-sdk'
const VERSION_TIMEOUT_MS = 5_000

type ClaudeExecutableSource = 'bundled' | 'configured' | 'installed'

export type ClaudeExecutable = {
  path: string
  source: ClaudeExecutableSource
  /** `null` when the binary did not answer `--version`. */
  version: string | null
}

/** Everything the resolver asks the machine. Tests replace it so no binary runs. */
export type ClaudeExecutableProbe = {
  bundled: () => ClaudeExecutable | null
  version: (executablePath: string, env: NodeJS.ProcessEnv) => Promise<string | null>
  which: (command: string, env: NodeJS.ProcessEnv) => string | null
}

const defaultProbe: ClaudeExecutableProbe = {
  bundled: bundledClaudeExecutable,
  version: readClaudeVersion,
  which: (command, env) => Bun.which(command, { PATH: env.PATH ?? '' }),
}

/**
 * An explicit `binaryPath` always wins and must exist. Otherwise the `claude` on
 * the instance's PATH runs, unless it is older than the SDK's bundled CLI: an
 * older CLI under a newer SDK is protocol skew.
 */
export async function resolveClaudeExecutable(input: {
  binaryPath?: string
  env: NodeJS.ProcessEnv
  probe?: ClaudeExecutableProbe
}): Promise<ClaudeExecutable> {
  const probe = input.probe ?? defaultProbe
  const configured = input.binaryPath?.trim()
  if (configured) return configuredExecutable(configured, input.env, probe)

  const bundled = probe.bundled()
  const installedPath = probe.which('claude', input.env)
  if (!installedPath && bundled) return bundled
  if (!installedPath)
    throw sessionIdentityErrors.NOT_INSTALLED({ internal: { provider: 'claude' } })

  const installed: ClaudeExecutable = {
    path: installedPath,
    source: 'installed',
    version: await probe.version(installedPath, input.env),
  }
  if (!bundled) return installed

  return newerOrBundled(installed, bundled)
}

/** The CLI the agent SDK ships in its platform package, or `null` where none is installed. */
function bundledClaudeExecutable(): ClaudeExecutable | null {
  try {
    const sdkEntry = createRequire(import.meta.url).resolve(SDK_ENTRY)
    const manifest = createRequire(sdkEntry).resolve(
      `${SDK_ENTRY}-${process.platform}-${process.arch}/package.json`,
    )
    const binary = process.platform === 'win32' ? 'claude.exe' : 'claude'

    return {
      path: path.join(path.dirname(manifest), binary),
      source: 'bundled',
      version: sdkClaudeCodeVersion(sdkEntry),
    }
  } catch {
    return null
  }
}

export function parseClaudeVersion(output: string): string | null {
  return /\d+\.\d+\.\d+/.exec(output)?.[0] ?? null
}

async function configuredExecutable(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  probe: ClaudeExecutableProbe,
): Promise<ClaudeExecutable> {
  const resolved = probe.which(binaryPath, env)
  if (!resolved) {
    throw sessionIdentityErrors.CLAUDE_BINARY_MISSING({
      internal: { binaryPathKind: binaryPath.includes(path.sep) ? 'path' : 'command' },
    })
  }

  return { path: resolved, source: 'configured', version: await probe.version(resolved, env) }
}

/** An unreadable installed version cannot prove it is new enough, so the bundled CLI runs. */
function newerOrBundled(installed: ClaudeExecutable, bundled: ClaudeExecutable) {
  if (!installed.version) return bundled
  if (!bundled.version) return installed

  return Bun.semver.order(installed.version, bundled.version) < 0 ? bundled : installed
}

function sdkClaudeCodeVersion(sdkEntry: string): string | null {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(path.dirname(sdkEntry), 'package.json'), 'utf8'),
  )
  if (typeof manifest !== 'object' || manifest === null) return null
  if (!('claudeCodeVersion' in manifest)) return null

  return typeof manifest.claudeCodeVersion === 'string' ? manifest.claudeCodeVersion : null
}

async function readClaudeVersion(executablePath: string, env: NodeJS.ProcessEnv) {
  try {
    const child = Bun.spawn([executablePath, '--version'], {
      env,
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'pipe',
      timeout: VERSION_TIMEOUT_MS,
    })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])

    return exitCode === 0 ? parseClaudeVersion(stdout) : null
  } catch {
    return null
  }
}
