import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { platformHomePath } from '../home'
import { RUNTIME_MANIFEST, writeRuntimeManifest } from '../installation/release-files'
import { updateErrors } from './structured-errors'
import type { ReleaseSource } from './update'

const serverPackage = path.resolve(import.meta.dirname, '../..')
const checkoutRoot = path.resolve(serverPackage, '../..')
// The build being shipped and the one before it; older outgoing builds are deleted.
const KEEP_OUTGOING = 2

/** Builds `apps/server` from this working tree into `outgoing/<name>/server`, ready to ship. */
export async function buildWorkingTree(): Promise<ReleaseSource> {
  const startedAt = Date.now()
  const build = Bun.spawn({
    cmd: [process.execPath, 'run', 'build'],
    cwd: serverPackage,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ])
  if (exitCode !== 0)
    throw updateErrors.build({ internal: { exitCode, log: (stdout + stderr).trim().slice(-2000) } })

  const name = await devReleaseName()
  const outgoing = platformHomePath('outgoing')
  const directory = path.join(outgoing, name)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  await cp(path.join(serverPackage, 'dist'), path.join(directory, 'server'), { recursive: true })
  await writeRuntimeManifest(path.join(directory, 'server'), path.join(checkoutRoot, 'bun.lock'))
  await pruneOutgoing(outgoing, name)
  const manifest = await readFile(path.join(directory, 'server', RUNTIME_MANIFEST))
  return {
    directory,
    name,
    manifestSha: createHash('sha256').update(manifest).digest('hex'),
    origin: 'dev-build',
    buildMs: Date.now() - startedAt,
    bundleBytes: (await stat(path.join(directory, 'server', 'index.js'))).size,
  }
}

/** `dev-<stamp>-<commit>[-dirty]`, so `/release` through the machine's proxy names the tree. */
async function devReleaseName() {
  const stamp = new Date().toISOString().replaceAll(/[-:]|\.\d+/g, '')
  const commit = (await git(['rev-parse', '--short=8', 'HEAD'])) || 'unknown'
  const dirty = (await git(['status', '--porcelain'])) ? '-dirty' : ''
  return `dev-${stamp}-${commit}${dirty}`
}

async function git(args: readonly string[]) {
  const child = Bun.spawn({
    cmd: ['git', ...args],
    cwd: checkoutRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [exitCode, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  return exitCode === 0 ? output.trim() : ''
}

async function pruneOutgoing(outgoing: string, current: string) {
  const builds = (await readdir(outgoing)).filter((entry) => entry.startsWith('dev-')).sort()
  const keep = new Set([...builds.slice(-KEEP_OUTGOING), current])
  for (const entry of builds) {
    if (keep.has(entry)) continue
    await rm(path.join(outgoing, entry), { recursive: true, force: true })
  }
}
