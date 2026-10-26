import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { createBenchmarkError } from './structured-errors.mjs'

const webManifest = new URL('../package.json', import.meta.url)

export function installedPackageFingerprint(name, consumer = webManifest) {
  const require = createRequire(consumer)
  const root = packageRoot(require.resolve(name), name)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const hash = createHash('sha256')
  for (const file of packageFiles(root).sort()) {
    hash.update(relative(root, file).split(sep).join('/')).update('\0')
    hash.update(readFileSync(file)).update('\0')
  }
  return { name, version: manifest.version, sha256: hash.digest('hex') }
}

export function installedDependencyFingerprint(prefix, consumer = webManifest) {
  const manifest = JSON.parse(readFileSync(consumer, 'utf8'))
  const packages = Object.keys(manifest.dependencies)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => installedPackageFingerprint(name, consumer))
  if (packages.length === 0) throw createBenchmarkError(`No installed dependencies match ${prefix}`)
  const sha256 = createHash('sha256').update(JSON.stringify(packages)).digest('hex')
  return { packages, sha256 }
}

function packageRoot(entry, name) {
  let directory = dirname(entry)
  while (true) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name)
      return directory
    const parent = dirname(directory)
    if (parent === directory) throw createBenchmarkError(`No package manifest found for ${name}`)
    directory = parent
  }
}

function packageFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const file = join(root, entry.name)
    if (entry.isDirectory()) files.push(...packageFiles(file))
    else files.push(file)
  }
  return files
}
