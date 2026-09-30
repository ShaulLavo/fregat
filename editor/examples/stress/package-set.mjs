import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fail } from './errors.mjs'

const manifestName = 'package-set.json'
const digest = (value) => createHash('sha256').update(value).digest('hex')

async function hashDirectory(directory) {
  const hash = createHash('sha256')
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      fail(`Frozen package content contains a symbolic link: ${directory}`)
    if (entry.isFile()) files.push(resolve(entry.parentPath, entry.name))
  }
  for (const path of files.sort())
    hash.update(relative(directory, path).split(sep).join('/')).update(await readFile(path))
  return hash.digest('hex')
}

async function inspectPackage(directory, folder) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (!manifest.name?.startsWith('@singapore-editor/') || !manifest.exports?.['.'])
    fail(`Editor package requires its public exports: ${folder}`)
  const require = createRequire(resolve(directory, 'package.json'))
  const links = Object.fromEntries(
    Object.keys(manifest.dependencies ?? {})
      .sort()
      .map((name) => {
        try {
          return [name, require.resolve(name)]
        } catch {
          return [name, 'no root entry; subpath exports only']
        }
      }),
  )
  return {
    folder,
    name: manifest.name,
    version: manifest.version,
    exports: manifest.exports,
    manifestHash: digest(await readFile(resolve(directory, 'package.json'))),
    sourceHash: await hashDirectory(resolve(directory, 'src')),
    buildHash: await hashDirectory(resolve(directory, 'dist')),
    links,
  }
}

export async function freezePackageSet(source, destination, origin) {
  const directory = resolve(destination)
  await mkdir(directory)
  const folders = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const packages = []
  for (const folder of folders) {
    const input = resolve(source, folder)
    const output = resolve(directory, folder)
    const identity = await inspectPackage(input, folder)
    await mkdir(output)
    for (const path of ['src', 'dist', 'package.json'])
      await cp(resolve(input, path), resolve(output, path), { recursive: true })
    if ((await stat(resolve(input, 'node_modules')).catch(() => null))?.isDirectory())
      await symlink(resolve(input, 'node_modules'), resolve(output, 'node_modules'), 'dir')
    packages.push(identity)
  }
  if (!packages.some((entry) => entry.name === '@singapore-editor/core'))
    fail('Frozen package set has no core')
  const manifest = { schemaVersion: 1, origin, packages }
  await writeFile(resolve(directory, manifestName), JSON.stringify(manifest, null, 2) + '\n')
  return loadPackageSet(directory)
}

export async function loadPackageSet(path) {
  const directory = resolve(path)
  const manifest = JSON.parse(await readFile(resolve(directory, manifestName), 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.packages) ||
    !manifest.packages.length
  )
    fail('Invalid frozen Editor package set')
  const actualFolders = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (
    JSON.stringify(actualFolders) !==
    JSON.stringify(manifest.packages.map((entry) => entry.folder).sort())
  )
    fail('Frozen package set membership changed')
  const aliases = []
  for (const expected of manifest.packages) {
    const packageDirectory = resolve(directory, expected.folder)
    const actual = await inspectPackage(packageDirectory, expected.folder)
    for (const key of ['name', 'version', 'manifestHash', 'sourceHash', 'buildHash'])
      if (actual[key] !== expected[key]) fail(`Frozen package ${expected.name} changed ${key}`)
    for (const [subpath, target] of Object.entries(expected.exports)) {
      const entry = typeof target === 'string' ? target : (target.import ?? target.default)
      if (typeof entry !== 'string' || !entry.startsWith('./dist/'))
        fail(`Unsupported frozen export: ${expected.name}${subpath}`)
      const replacement = resolve(packageDirectory, entry)
      if (!replacement.startsWith(resolve(packageDirectory, 'dist') + sep))
        fail('Frozen export escapes dist')
      const specifier = expected.name + (subpath === '.' ? '' : subpath.slice(1))
      if (subpath.includes('*')) {
        const escaped = specifier
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('(.+)')
        aliases.push({
          find: new RegExp(`^${escaped}$`),
          replacement: replacement.replace('*', '$1'),
        })
        continue
      }
      if (!(await stat(replacement)).isFile()) fail(`Missing frozen export: ${specifier}`)
      aliases.push({ find: specifier, replacement })
    }
  }
  aliases.sort((left, right) => String(right.find).length - String(left.find).length)
  return {
    directory,
    aliases,
    manifest,
    sourceHash: digest(
      JSON.stringify(
        manifest.packages.map(({ name, sourceHash, manifestHash }) => ({
          name,
          sourceHash,
          manifestHash,
        })),
      ),
    ),
    buildHash: digest(
      JSON.stringify(manifest.packages.map(({ name, buildHash }) => ({ name, buildHash }))),
    ),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, destination, commit, dirtyDiffHash, lockHash] = process.argv.slice(2)
  if (!source || !destination || !commit || !dirtyDiffHash || !lockHash)
    fail(
      'Usage: package-set.mjs source-packages frozen-directory commit dirty-diff-sha256 lock-sha256',
    )
  const set = await freezePackageSet(source, destination, { commit, dirtyDiffHash, lockHash })
  console.log(
    JSON.stringify({
      directory: set.directory,
      sourceHash: set.sourceHash,
      buildHash: set.buildHash,
      packages: set.manifest.packages.length,
    }),
  )
}
