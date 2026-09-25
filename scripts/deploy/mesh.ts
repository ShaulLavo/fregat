import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import {
  checkoutRoot,
  currentLink,
  liveCheckScript,
  meshHost,
  meshRoute,
  meshUrl,
  productionRoot,
  releasesRoot,
  serverPort,
  serverUnit,
  webBase,
} from './config'
import {
  bootCandidate,
  buildServer,
  buildWeb,
  copyServer,
  createRelease,
  currentRelease,
  pointCurrentAt,
  readBuildConfig,
  readCheckout,
  swapCurrent,
  verifyCandidateFiles,
  writeBuildConfig,
  type Release,
} from './release'
import { log, output, run } from './run'
import { installUnit, restartServer, waitForServerRelease } from './systemd'
import { createScriptError } from '../structured-errors'

const usage = `Usage: bun run deploy [options]

  --server            Build and restart the server too (drops live terminal and agent sessions).
                      Without it the release reuses the running server bundle and needs no restart.
  --slug=<name>       Release name suffix. Defaults to the branch name.
  --reason=<text>     Recorded in build-config.json.
  --skip-live-check   Swap without the headless browser check against ${meshUrl}.
  --rollback          Point current at the previous release and restart if its server differs.
  --help`

const MIN_FREE_BYTES = 2 * 1024 ** 3

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: 'boolean', default: false },
      reason: { type: 'string' },
      rollback: { type: 'boolean', default: false },
      server: { type: 'boolean', default: false },
      'skip-live-check': { type: 'boolean', default: false },
      slug: { type: 'string' },
    },
    strict: true,
  })
  if (values.help) {
    console.log(usage)
    return
  }
  if (values.rollback) {
    await rollback(values['skip-live-check'])
    return
  }

  await deploy({
    liveCheck: !values['skip-live-check'],
    reason: values.reason ?? null,
    server: values.server,
    slug: values.slug,
  })
}

type DeployOptions = { liveCheck: boolean; reason: string | null; server: boolean; slug?: string }

async function deploy(options: DeployOptions) {
  await preflight()
  const checkout = await readCheckout()
  const release = createRelease(checkout, slugFor(options.slug, checkout.branch))
  log('release', release.name)
  if (checkout.dirtyFiles.length > 0)
    log('release', `checkout is dirty (${checkout.dirtyFiles.length} files)`)

  await buildWeb(release)
  const serverSource = await provideServer(release, options.server)
  writeBuildConfig(release, {
    ...checkout,
    release: release.directory,
    source: checkoutRoot,
    webBase,
    meshUrl,
    previousRelease: release.previous,
    server: serverSource,
    reason: options.reason,
    builtAt: new Date().toISOString(),
  })

  log('verify', 'candidate files')
  await verifyCandidateFiles(release)
  log('verify', 'booting the candidate server')
  await bootCandidate(release)

  const unitChanged = await installUnit()
  swapCurrent(release)
  const restart = options.server || unitChanged
  if (restart) {
    await restartServer()
    await waitForServerRelease(options.server ? release.name : path.basename(serverSource))
  }
  if (options.liveCheck) await liveCheck(release, restart)

  console.log(`\n[deploy] ${release.name} is live at ${meshUrl}`)
}

async function provideServer(release: Release, build: boolean) {
  if (build) {
    await buildServer(release)
    return release.directory
  }
  const running = release.previous && serverReleaseOf(release.previous)
  if (!running)
    throw createScriptError('No deployed server to reuse. Run with --server for the first deploy.')

  copyServer(release, running)
  return running
}

// A web-only release copies its server from the previous one, which may itself
// have copied it: follow the chain to the release that built it.
function serverReleaseOf(directory: string): string | null {
  const config = readBuildConfig(directory)
  if (!config) return existsSync(path.join(directory, 'server')) ? directory : null
  if (config.server === directory) return directory

  return serverReleaseOf(config.server)
}

async function rollback(skipLiveCheck: boolean) {
  const current = currentRelease()
  if (!current) throw createScriptError('Nothing is deployed.')
  const previous = readBuildConfig(current)?.previousRelease
  if (!previous || !existsSync(previous))
    throw createScriptError(`${current} records no previous release.`)

  const restart = serverReleaseOf(previous) !== serverReleaseOf(current)
  pointCurrentAt(previous)
  if (restart) {
    await restartServer()
    await waitForServerRelease(path.basename(serverReleaseOf(previous) ?? previous))
  }
  const release: Release = {
    name: path.basename(previous),
    directory: previous,
    web: path.join(previous, 'web'),
    server: path.join(previous, 'server'),
    previous: readBuildConfig(previous)?.previousRelease ?? null,
  }
  if (!skipLiveCheck) await liveCheck(release, restart)
  console.log(`\n[deploy] rolled back to ${release.name} at ${meshUrl}`)
}

async function liveCheck(release: Release, restarted: boolean) {
  log('live', `checking ${meshUrl}`)
  const previousCheck = release.previous ? path.join(release.previous, 'live-check.json') : ''
  const result = await run(
    [
      'node',
      liveCheckScript,
      `--release=${release.name}`,
      `--out=${release.directory}`,
      `--baseline=${previousCheck}`,
    ],
    { cwd: checkoutRoot, env: { ...Bun.env, PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers() } },
  )
  process.stdout.write(result.stdout)
  if (result.code === 0) return

  const restartHint = restarted ? ' (the previous server will be restarted)' : ''
  throw createScriptError(
    `Live check failed for ${release.name}. See ${path.join(release.directory, 'live-check.json')}.\n` +
      `Roll back${restartHint}: bun run deploy --rollback`,
  )
}

async function preflight() {
  if (!existsSync(productionRoot) || !statSync(productionRoot).isDirectory()) {
    throw createScriptError(`${productionRoot} is missing. Mount /work before deploying.`)
  }
  const available = Number(
    (await output(['df', '--output=avail', '-B1', productionRoot])).split('\n').at(-1),
  )
  if (!(available > MIN_FREE_BYTES))
    throw createScriptError(
      `${productionRoot} has ${available} bytes free; need ${MIN_FREE_BYTES}.`,
    )
  await assertMeshRoute()
  log('preflight', `${releasesRoot}, current → ${currentRelease() ?? 'nothing'}`)
}

// Mesh only exposes the port (its D22); the route is set up once by hand.
async function assertMeshRoute() {
  const table = await output(['mesh', 'serve', 'ls'])
  const route = table.split('\n').find((line) => line.trim().startsWith(`${meshRoute} `))
  const expected = new RegExp(`^${meshRoute}\\s+${meshHost}\\s+proxy\\s+${serverPort}\\s`)
  if (route && expected.test(route.trim())) return

  throw createScriptError(
    `Mesh does not route ${meshRoute} to port ${serverPort}. Run:\n` +
      `  mesh unserve ${meshRoute}\n  mesh serve ${meshHost} ${serverPort} --at ${meshRoute} --isolate\n` +
      `Then retry. (${serverUnit} listens on ${serverPort}; current link: ${currentLink})`,
  )
}

function slugFor(slug: string | undefined, branch: string) {
  const raw = slug ?? branch ?? 'deploy'
  const clean = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  if (!clean) throw createScriptError(`Cannot derive a release slug from "${raw}". Pass --slug.`)
  return clean
}

function playwrightBrowsers() {
  const cache = '/work/cache/ms-playwright'
  return Bun.env.PLAYWRIGHT_BROWSERS_PATH ?? (existsSync(cache) ? cache : '')
}
