import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import {
  checkoutRoot,
  currentLink,
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
  carryAssets,
  buildServer,
  buildWeb,
  copyServer,
  createRelease,
  currentRelease,
  pendingRelease,
  pointCurrentAt,
  readBuildConfig,
  readCheckout,
  removePending,
  stagePending,
  swapCurrent,
  verifyCandidateFiles,
  writeBuildConfig,
  type Release,
} from './release'
import { log, output, run } from './run'
import { installUnit, notifyServer, restartInto } from './systemd'
import {
  liveCheckCommand,
  liveCheckUnitName,
  signalServer,
  type LiveCheckTarget,
} from './systemd/promote'
import { createScriptError } from '../structured-errors'

const usage = `Usage: bun run deploy [options]

  --server            Build the server too and stage the release. The app shows "Update available";
                      the server restarts when someone clicks Restart.
                      Without it the release reuses the running server bundle and goes live at once,
                      or, while a server release is staged, builds on it and goes live at Restart.
  --slug=<name>       Release name suffix. Defaults to the branch name.
  --reason=<text>     Recorded in build-config.json.
  --skip-live-check   Skip the headless browser check against ${meshUrl}, after a restart too.
  --rollback          Point current at the previous release, drop any staged release, and restart
                      now if its server differs.
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

const LIVE_CHECK_WAIT_MS = 240_000

async function deploy(options: DeployOptions) {
  await preflight()
  const staged = pendingRelease()
  const checkout = await readCheckout()
  const release = createRelease(checkout, slugFor(options.slug, checkout.branch))
  log('release', release.name)
  if (checkout.dirtyFiles.length > 0)
    log('release', `checkout is dirty (${checkout.dirtyFiles.length} files)`)

  await buildWeb(release)
  if (release.previous) {
    const carried = carryAssets(path.join(release.previous, 'web'), release.web)
    log('web', `carried ${carried} hashed assets from ${path.basename(release.previous)}`)
  }
  const serverSource = await provideServer(release, options.server, staged)
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
    liveCheck: options.liveCheck,
  })

  log('verify', 'candidate files')
  verifyCandidateFiles(release)
  log('verify', 'booting the candidate server')
  await bootCandidate(release)

  await installUnit()
  assertUnmoved(release, staged)
  if (options.server || staged) {
    await stage(release, options.server ? null : staged, options.liveCheck)
    return
  }

  swapCurrent(release)
  await checkInPlace(liveTarget(release.directory, release.previous), options.liveCheck)
  console.log(`\n[deploy] ${release.name} is live at ${meshUrl}`)
}

async function stage(release: Release, carrier: string | null, liveCheckEnabled: boolean) {
  stagePending(release)
  const outcome = await notifyServer(release.name)
  if (outcome === 'staged') {
    const on = carrier
      ? ` (on the staged server ${path.basename(carrier)}; it goes live at Restart)`
      : ''
    console.log(
      `\n[deploy] ${release.name} staged${on}. ` +
        'The app shows "Update available"; the server restarts when someone clicks Restart.\n' +
        `[deploy] Did it land: curl -s http://127.0.0.1:${serverPort}/release | jq '.server.release, .pending'`,
    )
    return
  }
  log('systemd', `${serverUnit} ${outcome} into ${release.name}`)
  if (liveCheckEnabled) await awaitLiveCheck(liveTarget(release.directory, release.previous))
  console.log(`\n[deploy] ${release.name} is live at ${meshUrl}`)
}

function assertUnmoved(release: Release, staged: string | null) {
  if (pendingRelease() === staged && currentRelease() === release.previous) return

  throw createScriptError(
    'Another release was staged or promoted while this deploy ran. Run the deploy again.',
  )
}

async function provideServer(release: Release, build: boolean, staged: string | null) {
  if (build) {
    await buildServer(release)
    return release.directory
  }
  const base = staged ?? release.previous
  const running = base && serverReleaseOf(base)
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
  const dropped = removePending()
  if (dropped) log('rollback', `dropped the staged ${dropped}`)
  const current = currentRelease()
  if (!current) throw createScriptError('Nothing is deployed.')
  const previous = readBuildConfig(current)?.previousRelease
  if (!previous || !existsSync(previous))
    throw createScriptError(`${current} records no previous release.`)

  const target = liveTarget(previous, readBuildConfig(previous)?.previousRelease ?? null)
  const restart = serverReleaseOf(previous) !== serverReleaseOf(current)
  pointCurrentAt(previous)
  if (!restart) await checkInPlace(target, !skipLiveCheck)
  else if (await restartInto(target, !skipLiveCheck)) await awaitLiveCheck(target)
  console.log(`\n[deploy] rolled back to ${target.name} at ${meshUrl}`)
}

function liveTarget(directory: string, previous: string | null): LiveCheckTarget {
  return { name: path.basename(directory), directory, previous, source: checkoutRoot }
}

// The server re-reads the verdict on the signal and shows it to open tabs, failed ones too.
async function checkInPlace(target: LiveCheckTarget, enabled: boolean) {
  const passed = !enabled || (await liveCheck(target))
  await signalServer(serverPort)
  if (!passed) throw liveCheckFailure(target, false)
}

async function liveCheck(target: LiveCheckTarget) {
  log('live', `checking ${meshUrl}`)
  const command = liveCheckCommand(target, productionRoot, 0)
  const result = await run(command.argv, {
    cwd: command.cwd,
    env: { ...Bun.env, ...command.env },
  })
  process.stdout.write(result.stdout)
  return result.code === 0
}

/** Reads the verdict the live check unit writes after the restart. */
async function awaitLiveCheck(target: LiveCheckTarget) {
  const unit = liveCheckUnitName(target)
  const file = path.join(target.directory, 'live-check.json')
  log('live', `waiting for ${unit} (journalctl --user -u ${unit})`)
  const status = await pollLiveCheck(file)
  if (status === 'failed') throw liveCheckFailure(target, true)
  if (status === 'passed') {
    console.log(`[live] passed — ${file}`)
    return
  }
  throw createScriptError(
    `No live check verdict for ${target.name} within ${LIVE_CHECK_WAIT_MS}ms. ` +
      `Check: journalctl --user -u ${unit}`,
  )
}

async function pollLiveCheck(file: string) {
  const deadline = Date.now() + LIVE_CHECK_WAIT_MS
  while (Date.now() < deadline) {
    const status = readLiveCheckStatus(file)
    if (status) return status
    await Bun.sleep(1_000)
  }
  return null
}

function readLiveCheckStatus(file: string): string | null {
  if (!existsSync(file)) return null
  try {
    const report = JSON.parse(readFileSync(file, 'utf8')) as { status?: unknown }
    return typeof report.status === 'string' ? report.status : null
  } catch {
    return null
  }
}

function liveCheckFailure(target: LiveCheckTarget, restarted: boolean) {
  const restartHint = restarted ? ' (the previous server will be restarted)' : ''
  return createScriptError(
    `Live check failed for ${target.name}. See ${path.join(target.directory, 'live-check.json')}.\n` +
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
  const staged = pendingRelease()
  const pending = staged ? `, pending → ${path.basename(staged)}` : ''
  log('preflight', `${releasesRoot}, current → ${currentRelease() ?? 'nothing'}${pending}`)
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
