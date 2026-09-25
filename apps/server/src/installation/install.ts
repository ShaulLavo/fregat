import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import { writeFileAtomic } from '../fs/atomic-write'
import { createStructuredError } from '../observability/structured-errors'
import { shellQuote } from '../utils/shell'
import { installationSchema, type ServerInstallation } from './descriptor'

export async function installServerLauncher(options: {
  homeDirectory: string
  installation: ServerInstallation
}) {
  const installation = v.parse(installationSchema, options.installation)
  await access(installation.executable, constants.X_OK)
  await access(path.join(installation.directory, 'apps/server/src/index.ts'))
  await access(path.join(installation.directory, 'packages/contracts/src/health.ts'))
  for (const dependency of ['evlog', 'valibot'])
    Bun.resolveSync(dependency, path.join(installation.directory, 'apps/server'))
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

function launcherSource(installation: ServerInstallation) {
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
