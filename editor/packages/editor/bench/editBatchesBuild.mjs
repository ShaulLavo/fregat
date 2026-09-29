import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const repository = resolve(import.meta.dirname, '../../..')
const buildScript = resolve(repository, 'scripts/build-package.ts')

export async function rebuildPackage(path, expectedName) {
  const directory = resolve(path)
  const packagePath = join(directory, 'package.json')
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  assert.equal(manifest.name, expectedName, 'Unexpected package selected for rebuild')
  const sourceDirectory = join(directory, 'src')
  const sourceSha256 = await hashDirectory(sourceDirectory)
  const inputs = await buildInputs(packagePath)
  await run('bun', [buildScript, directory], {
    cwd: repository,
    env: { ...process.env, TMPDIR: '/work/tmp' },
    maxBuffer: 20 * 1024 * 1024,
  })
  assert.equal(await hashDirectory(sourceDirectory), sourceSha256, 'Sources changed during build')
  assert.deepEqual(await buildInputs(packagePath), inputs, 'Build inputs changed during build')
  return {
    directory,
    sourceDirectory,
    sourceSha256,
    builtSha256: await hashDirectory(join(directory, 'dist')),
    provenance: { method: 'rebuild-before-capture', ...inputs },
  }
}

async function buildInputs(packagePath) {
  const files = {
    packageJson: packagePath,
    buildScript,
    tsconfig: join(repository, 'tsconfig.json'),
    lockfile: join(repository, 'bun.lock'),
  }
  const hashes = {}
  for (const [name, path] of Object.entries(files)) {
    hashes[name] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  }
  return hashes
}

export async function hashDirectory(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  assert.ok(
    !entries.some((entry) => entry.isSymbolicLink()),
    'Capture inputs must not contain symlinks',
  )
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(relative(directory, file)).update(await readFile(file))
  return hash.digest('hex')
}
