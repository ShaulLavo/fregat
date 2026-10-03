import { cpSync, existsSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import path from 'node:path'

import {
  checkoutRoot,
  currentLink,
  meshHost,
  meshRoute,
  meshUrl,
  productionRoot,
  requireDeployTarget,
  releasesRoot,
  serverPort,
  serverUnit,
  webBase,
} from './deploy/config'
import {
  bootCandidate,
  carryAssets,
  buildServer,
  buildWeb,
  copyServer,
  readBuildConfig,
  readCheckout,
  verifyCandidateFiles,
  writeBuildConfig,
  type Release,
} from './deploy/release'
import {
  createRelease,
  currentRelease,
  pendingRelease,
  pointCurrentAt,
  removePending,
  stagePending,
  swapCurrent,
} from './deploy/install-layout'
import { stampWebRelease } from './deploy/web-release'
import { log, output, run } from './deploy/run'
import { parseMeshRoutes } from './deploy/routes'
import { parseInstallArgs, type InstallOptions, type RestartRequest } from './deploy/args'
import { requestRestart, requireStaged } from './deploy/restart'
import { installUnit, notifyServer, restartInto, waitForServerRelease } from './deploy/systemd'
import {
  liveCheckCommand,
  liveCheckUnitName,
  signalServer,
  type LiveCheckTarget,
} from './deploy/systemd/promote'
import { readHomeSetting } from './home-setting'
import { productionStateHome } from './state-home'
import { createScriptError, scriptFailureText } from './structured-errors'

const usage = `Usage: bun run install-release [options]

  Mesh + user-systemd integration. Requires developer.deployTarget in production settings.

  --from=<directory>  Install a built release with a matching --base. Add --server to use its server.
  --server            Build or install the server and stage the release. The app shows "Update available";
                      the server restarts when someone clicks Restart, or at once with --restart.
                      Without --server, reuse the running server bundle and go live at once,
                      or reuse a pending server and go live with it at Restart.
  --restart           Restart into the staged release: the Restart button's request, which waits
                      for busy sessions up to developer.deployRestartWaitMinutes. Alone, it builds
                      nothing and restarts into what an earlier --server installation staged.
  --interrupt         With --restart, end busy turns and restart now. Needed inside a Platform chat,
                      whose own turn counts as busy.
  --slug=<name>       Release name suffix. Defaults to the branch name.
  --reason=<text>     Recorded in build-config.json.
  --skip-live-check   Skip the headless browser check against ${meshUrl}, after a restart too.
  --rollback          Point current at the previous release, drop any staged release, and restart
                      now if its server differs.
  --help`

const MIN_FREE_BYTES = 2 * 1024 ** 3
const LIVE_CHECK_WAIT_MS = 240_000

type InstallControl = {
  preflight: typeof preflight
  installUnit: typeof installUnit
  notifyServer: typeof notifyServer
  requestRestart: typeof requestRestart
  waitForServerRelease: typeof waitForServerRelease
  signalServer: typeof signalServer
  restartInto: typeof restartInto
}

const liveControl: InstallControl = {
  preflight,
  installUnit,
  notifyServer,
  requestRestart,
  waitForServerRelease,
  signalServer,
  restartInto,
}

export async function main(args = Bun.argv.slice(2), control = liveControl) {
  const command = parseInstallArgs(args)
  if (command.kind === 'help') return console.log(usage)
  requireDeployTarget()
  if (command.kind === 'rollback') return rollback(!command.liveCheck, control)
  if (command.kind === 'restart') return restartStaged(command.request, command.liveCheck, control)
  await install(command.options, control)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exit(1)
  }
}

async function install(options: InstallOptions, control: InstallControl) {
  await control.preflight()
  const staged = pendingRelease()
  const checkout = await readCheckout()
  const release = createRelease(checkout, slugFor(options.slug, checkout.branch))
  log('release', release.name)
  if (checkout.dirtyFiles.length > 0)
    log('release', `checkout is dirty (${checkout.dirtyFiles.length} files)`)

  const built = options.from ? readBuildConfig(path.resolve(options.from)) : null
  if (options.from && (!built || built.webBase !== webBase))
    throw createScriptError('The built release must match this installation base.', {
      fix: `Run bun run release --base=${webBase} --output=<directory>, then install-release --from=<directory>.`,
    })
  if (options.from) {
    cpSync(path.join(path.resolve(options.from), 'web'), release.web, { recursive: true })
    stampWebRelease(release.web, release.name)
  } else await buildWeb(release, webBase)

  if (release.previous) {
    const carried = carryAssets(path.join(release.previous, 'web'), release.web)
    log('web', `carried ${carried} hashed assets from ${path.basename(release.previous)}`)
  }
  const serverSource =
    options.from && options.server
      ? copyBuiltServer(release, path.resolve(options.from))
      : await provideServer(release, options.server, staged)
  writeBuildConfig(release, {
    ...(built ?? checkout),
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
  await verifyCandidateFiles(release, webBase)
  log('verify', 'booting the candidate server')
  await bootCandidate(release, webBase)

  await control.installUnit()
  assertUnmoved(release, staged)
  if (options.server || staged) {
    await stage(release, options.server ? null : staged, options, control)
    return
  }

  swapCurrent(release)
  await checkInPlace(liveTarget(release.directory, release.previous), options.liveCheck, control)
  console.log(`\n[install-release] ${release.name} is live at ${meshUrl}`)
}

async function stage(
  release: Release,
  carrier: string | null,
  options: InstallOptions,
  control: InstallControl,
) {
  stagePending(release)
  const outcome = await control.notifyServer(release.name)
  if (outcome === 'staged' && options.restart) {
    await restartStaged(options.restart, options.liveCheck, control)
    return
  }
  if (outcome === 'staged') {
    const on = carrier
      ? ` (on the staged server ${path.basename(carrier)}; it goes live at Restart)`
      : ''
    console.log(
      `\n[install-release] ${release.name} staged${on}. ` +
        'The app shows "Update available"; the server restarts when someone clicks Restart.\n' +
        `[install-release] Did it land: curl -s http://127.0.0.1:${serverPort}/release | jq '.server.release, .pending'`,
    )
    return
  }
  log('systemd', `${serverUnit} ${outcome} into ${release.name}`)
  if (options.liveCheck) await awaitLiveCheck(liveTarget(release.directory, release.previous))
  console.log(`\n[install-release] ${release.name} is live at ${meshUrl}`)
}

/** Restarts into the staged release through the server's own restart route, then checks it. */
async function restartStaged(
  request: RestartRequest,
  liveCheckEnabled: boolean,
  control: InstallControl,
) {
  const staged = requireStaged(pendingRelease(), productionRoot)
  const target = liveTarget(staged, currentRelease())
  const waitMinutes = readHomeSetting(productionStateHome, 'developer.deployRestartWaitMinutes')
  log('restart', `restarting ${serverUnit} into ${target.name}`)
  await control.requestRestart({
    interrupt: request.interrupt,
    waitMs: waitMinutes * 60_000,
    insidePlatform: Bun.env.PLATFORM_PRODUCTION_ROOT === productionRoot,
  })
  await control.waitForServerRelease(target.name)
  // Promotion starts the check unless the release was deployed with --skip-live-check.
  if (liveCheckEnabled && readBuildConfig(staged)?.liveCheck !== false) await awaitLiveCheck(target)
  console.log(`\n[install-release] ${target.name} is live at ${target.meshUrl}`)
}

function assertUnmoved(release: Release, staged: string | null) {
  if (pendingRelease() === staged && currentRelease() === release.previous) return

  throw createScriptError(
    'Another release was staged or promoted during installation. Run install-release again.',
  )
}

function copyBuiltServer(release: Release, from: string) {
  cpSync(path.join(from, 'server'), release.server, { recursive: true, verbatimSymlinks: true })
  if (existsSync(path.join(release.server, 'runtime/node_modules')))
    symlinkSync('server/runtime/node_modules', path.join(release.directory, 'node_modules'))
  return release.directory
}

async function provideServer(release: Release, build: boolean, staged: string | null) {
  if (build) {
    await buildServer(release)
    return release.directory
  }
  const base = staged ?? release.previous
  const running = base && serverReleaseOf(base)
  if (!running)
    throw createScriptError(
      'No installed server to reuse. Run with --server for the first installation.',
    )

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

async function rollback(skipLiveCheck: boolean, control: InstallControl) {
  const dropped = removePending()
  if (dropped) log('rollback', `dropped the staged ${dropped}`)
  const current = currentRelease()
  if (!current) throw createScriptError('No release is installed.')
  const previous = readBuildConfig(current)?.previousRelease
  if (!previous || !existsSync(previous))
    throw createScriptError(`${current} records no previous release.`)

  const target = liveTarget(previous, readBuildConfig(previous)?.previousRelease ?? null)
  const restart = serverReleaseOf(previous) !== serverReleaseOf(current)
  pointCurrentAt(previous)
  if (!restart) await checkInPlace(target, !skipLiveCheck, control)
  else if (await control.restartInto(target, !skipLiveCheck)) await awaitLiveCheck(target)
  console.log(`\n[install-release] rolled back to ${target.name} at ${target.meshUrl}`)
}

function liveTarget(directory: string, previous: string | null): LiveCheckTarget {
  return {
    name: path.basename(directory),
    directory,
    previous,
    source: checkoutRoot,
    meshUrl: readBuildConfig(directory)?.meshUrl ?? meshUrl,
  }
}

// The server re-reads the verdict on the signal and shows it to open tabs, failed ones too.
async function checkInPlace(target: LiveCheckTarget, enabled: boolean, control: InstallControl) {
  const passed = !enabled || (await liveCheck(target))
  await control.signalServer(serverPort)
  if (!passed) throw liveCheckFailure(target, false)
}

async function liveCheck(target: LiveCheckTarget) {
  log('live', `checking ${target.meshUrl}`)
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
      `Roll back${restartHint}: bun run install-release --rollback`,
  )
}

async function preflight() {
  if (!existsSync(productionRoot) || !statSync(productionRoot).isDirectory()) {
    throw createScriptError(
      `${productionRoot} is missing. Prepare the configured production directory before installing a release.`,
    )
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
  const routes = parseMeshRoutes(table)
  if (
    routes.some(
      (route) =>
        route.route === meshRoute &&
        route.host === meshHost &&
        route.kind === 'proxy' &&
        route.target === String(serverPort),
    )
  )
    return

  throw createScriptError(
    `Mesh does not route ${meshRoute} to port ${serverPort}. Run:\n` +
      `  mesh unserve ${meshRoute}\n  mesh serve ${meshHost} ${serverPort} --at ${meshRoute} --isolate\n` +
      `Then retry. (${serverUnit} listens on ${serverPort}; current link: ${currentLink})`,
  )
}

function slugFor(slug: string | undefined, branch: string) {
  const raw = slug ?? branch ?? 'release'
  const clean = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  if (!clean) throw createScriptError(`Cannot derive a release slug from "${raw}". Pass --slug.`)
  return clean
}
