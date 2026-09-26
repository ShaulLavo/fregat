import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { writeFileAtomic } from '../fs/atomic-write'
import { createStructuredError } from '../observability/structured-errors'
import { shellQuote } from '../utils/shell'
import {
  installationSchema,
  releaseEnv,
  releaseEntry,
  releaseServerRoot,
  type ReleaseInstallation,
  type ServerInstallation,
} from './descriptor'
import { REMOTE_SUPPORT } from './release-files'

export async function installServerLauncher(options: {
  homeDirectory: string
  installation: ServerInstallation
}) {
  const installation = v.parse(installationSchema, options.installation)
  await access(installation.executable, constants.X_OK)
  await assertInstallationFiles(installation)
  const destination = path.join(options.homeDirectory, '.local/bin/platform-server')
  await mkdir(path.dirname(destination), { recursive: true })
  try {
    await writeFileAtomic(destination, launcherSource(installation), {
      durability: 'rename',
      mode: 0o700,
    })
  } catch (cause) {
    throw createStructuredError({
      code: 'installation.WRITE_FAILED',
      status: 500,
      message: 'The Platform server launcher could not be installed.',
      why: 'The per-user launcher could not be written atomically.',
      fix: `Check write permissions for ${path.dirname(destination)} and run server:install again.`,
      cause,
    })
  }
  return destination
}

async function assertInstallationFiles(installation: ServerInstallation) {
  if (installation.kind === 'release') {
    await access(releaseEntry(installation))
    await access(path.join(installation.directory, 'server', REMOTE_SUPPORT))
    return
  }
  await access(path.join(installation.directory, 'apps/server/src/index.ts'))
  await access(path.join(installation.directory, 'packages/contracts/src/health.ts'))
  for (const dependency of ['evlog', 'valibot'])
    Bun.resolveSync(dependency, path.join(installation.directory, 'apps/server'))
}

/** The `platform-server` launcher: `--describe` prints the installation, anything else starts it. */
function launcherSource(installation: ServerInstallation) {
  if (installation.kind === 'release') return releaseLauncherSource(installation)
  const directory = shellQuote(installation.directory)
  const executable = shellQuote(installation.executable)
  const missing = shellQuote(
    'Platform server installation is unavailable. Run bun run server:install from a prepared Platform checkout on this machine.',
  )
  return `#!/bin/sh
if ! test -x ${executable} || ! test -f ${directory}/apps/server/src/index.ts; then
  printf '%s\\n' ${missing} >&2
  exit 1
fi
if test "\${1-}" = '--describe'; then
  printf '%s\\n' ${shellQuote(JSON.stringify(installation))}
  exit 0
fi
cd ${directory} || exit 1
exec ${executable} --env-file=.env apps/server/src/index.ts "$@"
`
}

// State lives under the remote user's ~/.platform, so a release takes no .env.
export function releaseLauncherSource(installation: ReleaseInstallation) {
  const entry = shellQuote(releaseEntry(installation))
  const env = Object.entries(releaseEnv(installation))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(' ')
  const executable = shellQuote(installation.executable)
  const missing = shellQuote(
    'Platform server release is unavailable. Install the server again from the Platform that connects to this machine.',
  )
  return `#!/bin/sh
if ! test -x ${executable} || ! test -f ${entry}; then
  printf '%s\\n' ${missing} >&2
  exit 1
fi
if test "\${1-}" = '--describe'; then
  printf '%s\\n' ${shellQuote(JSON.stringify(installation))}
  exit 0
fi
cd ${shellQuote(releaseServerRoot(installation))} || exit 1
export ${env}
exec ${executable} ${entry} "$@"
`
}
