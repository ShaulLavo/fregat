import { constants } from 'node:fs'
import { lstat, open, readdir, readlink } from 'node:fs/promises'
import { createHash, type Hash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import type { GitRepositoryRunner } from '../service'
import { gitWorktreeErrors } from './worktree-errors'
import { verifyWorktreeAdministration } from './worktree-paths'

export async function removalPreview(runner: GitRepositoryRunner, checkout: string) {
  await verifyWorktreeAdministration(runner, checkout)
  const args = ['-C', checkout]
  const head = await runner.run([...args, 'rev-parse', '--verify', 'HEAD'])
  const status = await runner.run([
    ...args,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=traditional',
  ])
  const index = await runner.run([...args, 'ls-files', '--stage', '-z'])
  const hash = createHash('sha256')
  addField(hash, 'platform-worktree-removal-v1')
  addField(hash, head.stdout.trim())
  addField(hash, index.stdout)
  try {
    addField(hash, await fingerprintEntry(Buffer.from(checkout), Buffer.alloc(0)))
  } catch (cause) {
    throw gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY({
      cause: cause instanceof Error ? cause : undefined,
      internal: { check: 'root-entry' },
    })
  }
  return {
    expectedHead: head.stdout.trim(),
    expectedStatusFingerprint: hash.digest('hex'),
    changedFileCount: changedFileCount(status.stdout),
  }
}

async function fingerprintEntry(absolutePath: Buffer, relativePath: Buffer): Promise<Buffer> {
  const before = await lstat(absolutePath, { bigint: true })
  const hash = createHash('sha256')
  addField(hash, relativePath)
  addField(hash, before.mode.toString())
  if (before.isSymbolicLink()) {
    addField(hash, await readlink(absolutePath, { encoding: 'buffer' }))
  } else if (before.isDirectory()) {
    await fingerprintDirectory(hash, absolutePath, relativePath, before)
  } else if (before.isFile()) {
    await fingerprintFile(hash, absolutePath, before)
  } else {
    throw gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY({
      internal: {
        check: 'entry-kind',
        isDirectory: before.isDirectory(),
        isFile: before.isFile(),
        isSymbolicLink: before.isSymbolicLink(),
      },
    })
  }
  assertUnchanged(before, await lstat(absolutePath, { bigint: true }))
  return hash.digest()
}

async function fingerprintDirectory(
  hash: Hash,
  absolutePath: Buffer,
  relativePath: Buffer,
  before: BigIntStats,
) {
  if ((before.mode & 0o444n) === 0n || (before.mode & 0o111n) === 0n) {
    throw gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY({
      internal: { check: 'directory-mode', mode: (before.mode & 0o7777n).toString(8) },
    })
  }
  const entries = (await readdir(absolutePath, { encoding: 'buffer' })).sort(Buffer.compare)
  for (const name of entries) {
    if (relativePath.length === 0 && name.equals(Buffer.from('.git'))) continue
    const relative = relativePath.length === 0 ? name : joinBytes(relativePath, name)
    addField(hash, await fingerprintEntry(joinBytes(absolutePath, name), relative))
  }
}

async function fingerprintFile(hash: Hash, absolutePath: Buffer, before: BigIntStats) {
  if ((before.mode & 0o444n) === 0n)
    throw gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY({
      internal: { check: 'file-mode', mode: (before.mode & 0o7777n).toString(8) },
    })
  const file = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    assertUnchanged(before, await file.stat({ bigint: true }))
    addField(hash, before.size.toString())
    for await (const bytes of file.createReadStream({ autoClose: false })) hash.update(bytes)
    assertUnchanged(before, await file.stat({ bigint: true }))
  } finally {
    await file.close()
  }
}

function assertUnchanged(before: BigIntStats, after: BigIntStats) {
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY({
      internal: {
        check: 'changed-during-scan',
        changed: ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].filter(
          (field) => before[field as 'ino'] !== after[field as 'ino'],
        ),
      },
    })
  }
}

function joinBytes(parent: Buffer, name: Buffer) {
  return Buffer.concat([parent, Buffer.from('/'), name])
}

function addField(hash: Hash, value: string | Buffer) {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value
  hash.update(`${bytes.length}:`)
  hash.update(bytes)
}

function changedFileCount(output: string) {
  const entries = output.split('\0')
  let count = 0
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    // An ignored dependency install is reinstallable; every other ignored path counts.
    if (!entry || /^!! (.*\/)?node_modules\//.test(entry)) continue
    count += 1
    if (entry.slice(0, 2).includes('R') || entry.slice(0, 2).includes('C')) index += 1
  }
  return count
}
