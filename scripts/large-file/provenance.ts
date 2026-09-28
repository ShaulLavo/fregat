import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createScriptError } from '../structured-errors'

export async function captureRevision(root: string, artifact: string) {
  const commit = (await git(root, ['rev-parse', 'HEAD'])).toString().trim()
  const status = (
    await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ).toString()
  const diff = await git(root, [
    'diff',
    '--binary',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--no-color',
    'HEAD',
    '--',
  ])
  const paths = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  const untracked = []
  for (const name of paths) {
    const file = path.join(root, name)
    const stat = await lstat(file)
    const hash = createHash('sha256')
    if (stat.isSymbolicLink()) hash.update(await readlink(file))
    else for await (const chunk of createReadStream(file)) hash.update(chunk)
    untracked.push({ path: name, mode: stat.mode, sha256: hash.digest('hex') })
  }
  const trackedDiffSha256 = createHash('sha256').update(diff).digest('hex')
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ commit, status, trackedDiffSha256, untracked }))
    .digest('hex')
  const diffArtifact = diff.byteLength <= 2 * 1024 * 1024 ? artifact : null
  if (diffArtifact) await writeFile(diffArtifact, diff)
  return {
    commit,
    cleanliness: status.length === 0 ? 'clean' : 'dirty',
    status: status.split('\0').filter(Boolean),
    fingerprint,
    trackedDiffSha256,
    trackedDiffBytes: diff.byteLength,
    diffArtifact,
    untracked,
  }
}

export function recordedBuildSource(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 2
  )
    return value
  return {
    cleanliness: 'unknown',
    reason: 'Build metadata predates source-state capture.',
    recorded: value,
  }
}

async function git(root: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [bytes, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw createScriptError(`Git provenance capture failed: ${stderr.trim()}`)
  return Buffer.from(bytes)
}
