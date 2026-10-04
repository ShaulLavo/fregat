import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { checkoutRoot } from '../checkout-root'
import { createScriptError } from '../structured-errors'
import { releaseAt } from './release-operations'
import {
  buildServer,
  buildWeb,
  readCheckout,
  verifyCandidateFiles,
  writeBuildConfig,
} from './release'
import { run } from './run'

type BuildOptions = { output?: string; base?: string; reason?: string }

/** The executor owns external compiler/package-manager processes; fixtures provide those processes' results. */
export async function buildPortableRelease(
  options: BuildOptions,
  execute = run,
  root = checkoutRoot,
) {
  const base = normalizeBase(options.base ?? '/')
  const checkout = await readCheckout(root)
  const directory = options.output
    ? path.resolve(options.output)
    : path.join(tmpdir(), `fregat-release-${checkout.commit.slice(0, 8)}-${randomUUID()}`)
  if (existsSync(directory))
    throw createScriptError('The release output directory already exists.', {
      fix: 'Pass --output=<new-directory> so the build owns its complete output.',
      internal: { outputExists: true },
    })
  mkdirSync(path.dirname(directory), { recursive: true })
  // Claim the output exclusively so a concurrent build cannot own the same directory.
  mkdirSync(directory)
  const release = releaseAt(directory)
  try {
    await buildWeb(release, base, execute, root)
    await buildServer(release, 'installed', process.arch, execute, root)
    mkdirSync(path.join(directory, 'bin'))
    copyFileSync(process.execPath, path.join(directory, 'bin', 'bun'))
    writeBuildConfig(release, {
      ...checkout,
      release: directory,
      source: root,
      webBase: base,
      meshUrl: '',
      previousRelease: null,
      server: directory,
      reason: options.reason ?? null,
      builtAt: new Date().toISOString(),
    })
    await verifyCandidateFiles(release, base)
    return release
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

function normalizeBase(base: string) {
  if (!/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?|)(?![\s\S])/.test(base))
    throw createScriptError('The release base must be an absolute application route.', {
      fix: 'Use --base=/ or slash-separated letters, numbers, underscores and hyphens.',
      internal: { validBase: false },
    })
  return base.endsWith('/') ? base : `${base}/`
}
