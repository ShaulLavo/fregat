import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkoutRoot, currentLink, pendingLink, releasesRoot, webBase } from './config'
import { log, output, run } from './run'
import { createScriptError } from '../structured-errors'

export type Checkout = {
  commit: string
  branch: string
  dirtyFiles: string[]
  editorCommit: string | null
}

export type Release = {
  name: string
  directory: string
  web: string
  server: string
  previous: string | null
}

export type BuildConfig = Checkout & {
  release: string
  source: string
  webBase: string
  meshUrl: string
  previousRelease: string | null
  server: string
  reason: string | null
  builtAt: string
  deployedAt?: string
  /** False when deployed with --skip-live-check; the promotion step then skips it too. */
  liveCheck?: boolean
}

const webPackage = path.join(checkoutRoot, 'apps/web')
const serverPackage = path.join(checkoutRoot, 'apps/server')
const productionEnv = {
  ...Bun.env,
  BUN_ENV: 'production',
  NODE_ENV: 'production',
  VITE_SERVER_URL: undefined,
}

export async function readCheckout(): Promise<Checkout> {
  const commit = await output(['git', 'rev-parse', 'HEAD'], checkoutRoot)
  if (!commit) throw createScriptError(`${checkoutRoot} is not a git checkout.`)

  const status = await output(['git', 'status', '--porcelain'], checkoutRoot)
  const editor = path.join(checkoutRoot, '../Editor')
  return {
    commit,
    branch: await output(['git', 'branch', '--show-current'], checkoutRoot),
    dirtyFiles: status ? status.split('\n').map((line) => line.slice(3)) : [],
    editorCommit: existsSync(editor)
      ? (await output(['git', 'rev-parse', 'HEAD'], editor)) || null
      : null,
  }
}

export function createRelease(checkout: Checkout, slug: string): Release {
  const stamp = new Date().toISOString().replaceAll(/[-:]|\.\d+/g, '')
  const name = `${stamp}-${checkout.commit.slice(0, 8)}-${slug}`
  const directory = path.join(releasesRoot, name)
  mkdirSync(directory, { recursive: true })
  return {
    name,
    directory,
    web: path.join(directory, 'web'),
    server: path.join(directory, 'server'),
    previous: currentRelease(),
  }
}

export function currentRelease() {
  if (!existsSync(currentLink)) return null

  return realpathSync(currentLink)
}

/** The staged release, or null when nothing is staged or the link dangles. */
export function pendingRelease() {
  if (!existsSync(pendingLink)) return null

  return realpathSync(pendingLink)
}

export function stagePending(release: Release) {
  const replaced = pendingRelease()
  replaceLink(pendingLink, release.directory)
  const note = replaced ? `, replacing ${path.basename(replaced)}` : ''
  log('stage', `${pendingLink} → ${release.name}${note}`)
}

/** Drops the staged release; returns its name, or null when nothing was staged. */
export function removePending() {
  if (!lstatSync(pendingLink, { throwIfNoEntry: false })?.isSymbolicLink()) return null
  const name = path.basename(readlinkSync(pendingLink))
  rmSync(pendingLink, { force: true })
  return name
}

export async function buildWeb(release: Release) {
  log('web', 'typecheck')
  await runOrFail(
    ['bunx', 'tsgo', '--build'],
    webPackage,
    path.join(release.directory, 'web-typecheck.log'),
  )
  log('web', `vite build → ${release.web}`)
  await runOrFail(
    ['bun', 'vite', 'build', '--base', webBase, '--outDir', release.web],
    webPackage,
    path.join(release.directory, 'web-build.log'),
  )
}

export async function buildServer(release: Release) {
  log('server', 'build')
  await runOrFail(
    ['bun', 'run', 'build'],
    serverPackage,
    path.join(release.directory, 'server-build.log'),
  )
  cpSync(path.join(serverPackage, 'dist'), release.server, { recursive: true })
  linkServerDependencies(release)
}

export function copyServer(release: Release, from: string) {
  log('server', `reusing ${path.basename(from)}`)
  cpSync(path.join(from, 'server'), release.server, { recursive: true, verbatimSymlinks: true })
  linkServerDependencies(release)
}

// The bundle resolves typescript, the language servers and its `--external`
// packages at runtime relative to its own path, exactly as `apps/server/dist`
// does, so the release borrows the checkout's installed dependencies.
function linkServerDependencies(release: Release) {
  replaceLink(path.join(release.server, 'node_modules'), path.join(serverPackage, 'node_modules'))
  replaceLink(path.join(release.directory, 'node_modules'), path.join(checkoutRoot, 'node_modules'))
}

export function writeBuildConfig(release: Release, config: BuildConfig) {
  writeFileSync(
    path.join(release.directory, 'build-config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

export function readBuildConfig(directory: string): BuildConfig | null {
  const file = path.join(directory, 'build-config.json')
  if (!existsSync(file)) return null

  return JSON.parse(readFileSync(file, 'utf8')) as BuildConfig
}

export function verifyCandidateFiles(release: Release) {
  const html = readFileSync(path.join(release.web, 'index.html'), 'utf8')
  const problems = [
    !html.includes(`src="${webBase}assets/`) &&
      `index.html does not load assets from ${webBase}assets/`,
    /(?:src|href)="\/assets\//.test(html) && 'index.html references root /assets/',
    html.includes('platform-api') && 'index.html still names the platform-api route',
    html.includes('%DEV%') && 'index.html kept the %DEV% placeholder',
    html.includes('%BASE_URL%') && 'index.html kept the %BASE_URL% placeholder',
    !readdirSync(path.join(release.web, 'assets')).some((file) => file.endsWith('.wasm')) &&
      'no wasm artifact in web/assets',
    !existsSync(path.join(release.server, 'index.js')) && 'server/index.js is missing',
  ].filter((problem): problem is string => typeof problem === 'string')
  if (problems.length === 0) return

  throw createScriptError(
    `Candidate ${release.name} failed verification:\n  ${problems.join('\n  ')}`,
  )
}

/** Boots the candidate server on a free port with throwaway state and reads it back. */
export async function bootCandidate(release: Release) {
  const scratch = path.join(tmpdir(), `platform-deploy-${release.name}`)
  rmSync(scratch, { force: true, recursive: true })
  mkdirSync(scratch, { recursive: true })
  const port = await freePort()
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(release.server, 'index.js')],
    cwd: release.directory,
    env: {
      ...productionEnv,
      FS_HOST: '127.0.0.1',
      FS_WATCH: 'false',
      OBSERVABILITY_DIR: path.join(scratch, 'logs'),
      PLATFORM_HOME: path.join(scratch, 'home'),
      PORT: String(port),
      WEB_ROOT: release.web,
      // The candidate must never read production's staged release.
      PLATFORM_PRODUCTION_ROOT: undefined,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  try {
    const origin = `http://127.0.0.1:${port}`
    const releaseBody = await waitForJson(`${origin}/release`, child)
    expectEqual('release', releaseBody.release, release.name)
    expectEqual('server.release', releaseBody.server?.release, release.name)
    const page = await fetch(`${origin}/~probe/workbench`, {
      headers: { 'sec-fetch-dest': 'document' },
    })
    expectEqual('document status', page.status, 200)
    if (!(await page.text()).includes(`${webBase}assets/`))
      throw createScriptError('Candidate page has no assets.')
    const asset = html(release.web).match(/src="\/platform\/(assets\/[^"]+)"/)?.[1]
    if (!asset) throw createScriptError('Candidate page names no entry script.')
    expectEqual('asset status', (await fetch(`${origin}/${asset}`)).status, 200)
    expectEqual('health without origin', (await fetch(`${origin}/health`)).status, 401)
  } catch (error) {
    const stderr = await new Response(child.stderr).text()
    writeFileSync(path.join(release.directory, 'candidate-server.log'), stderr)
    throw error
  } finally {
    child.kill()
    await child.exited
    rmSync(scratch, { force: true, recursive: true })
  }
  writeFileSync(
    path.join(release.directory, 'candidate-check.json'),
    `${JSON.stringify({ ok: true, port }, null, 2)}\n`,
  )
}

export function swapCurrent(release: Release) {
  replaceLink(currentLink, release.directory)
  log('swap', `${currentLink} → ${release.name}`)
}

export function pointCurrentAt(directory: string) {
  replaceLink(currentLink, directory)
  log('swap', `${currentLink} → ${path.basename(directory)}`)
}

// Swapped atomically: the link is written beside the target and renamed over it.
// The staging name is per process, so concurrent deploys cannot delete each other's.
function replaceLink(link: string, target: string) {
  const staging = `${link}.next-${process.pid}`
  rmSync(staging, { force: true })
  symlinkSync(target, staging)
  renameSync(staging, link)
}

function html(web: string) {
  return readFileSync(path.join(web, 'index.html'), 'utf8')
}

async function waitForJson(url: string, child: ReturnType<typeof Bun.spawn>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw createScriptError(`Candidate server exited with ${child.exitCode}.`)
    try {
      const response = await fetch(url)
      if (response.ok)
        return (await response.json()) as { release?: string; server?: { release?: string | null } }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(250)
  }

  throw createScriptError(`Candidate server did not answer ${url} within ${timeoutMs}ms.`)
}

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) return

  throw createScriptError(
    `Candidate ${label}: expected ${String(expected)}, got ${String(actual)}.`,
  )
}

async function freePort() {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = probe.port
  await probe.stop(true)
  return port
}

async function runOrFail(command: string[], cwd: string, logFile: string) {
  const result = await run(command, { cwd, env: productionEnv, log: logFile })
  if (result.code === 0) return

  throw createScriptError(`${command.join(' ')} failed with exit ${result.code}. See ${logFile}`)
}
