import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fail } from './errors.mjs'

export async function loadCorePackage(path) {
  const directory = resolve(path)
  const sourceDirectory = resolve(directory, 'src')
  const distDirectory = resolve(directory, 'dist')
  await requirePath(sourceDirectory, 'directory')
  await requirePath(distDirectory, 'directory')
  const packagePath = resolve(directory, 'package.json')
  await requirePath(packagePath, 'file')
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  if (manifest?.name !== '@singapore-editor/core' || !manifest.exports?.['.'])
    fail('Core package must export @singapore-editor/core')
  const aliases = []
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath !== '.' && !/^\.\/[\w./-]+$/.test(subpath))
      fail(`Unsupported core export: ${subpath}`)
    const entry = typeof target === 'string' ? target : (target?.import ?? target?.default)
    if (typeof entry !== 'string' || !entry.startsWith('./dist/'))
      fail(`Core export must resolve inside dist: ${subpath}`)
    const replacement = resolve(directory, entry)
    const distPath = relative(distDirectory, replacement)
    if (!distPath || distPath === '..' || distPath.startsWith(`..${sep}`))
      fail(`Core export escapes dist: ${subpath}`)
    await requirePath(replacement, 'file')
    aliases.push({
      find: `@singapore-editor/core${subpath === '.' ? '' : subpath.slice(1)}`,
      replacement,
    })
  }
  aliases.sort((left, right) => right.find.length - left.find.length)
  return { directory, sourceDirectory, aliases }
}

async function requirePath(path, kind) {
  const entry = await stat(path).catch(() => undefined)
  if (kind === 'directory' ? entry?.isDirectory() : entry?.isFile()) return
  fail(`Core package requires an existing ${kind}: ${path}`)
}

export async function hashBenchmarkSource(repository, files, coreSourceDirectory) {
  const sourceFiles = new Map()
  for (const file of files) {
    if (file.startsWith('packages/editor/src/')) continue
    sourceFiles.set(file, resolve(repository, file))
  }
  const entries = await readdir(coreSourceDirectory, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    const path = resolve(entry.parentPath, entry.name)
    if (entry.isSymbolicLink()) fail(`Core source must not contain symbolic links: ${path}`)
    if (!entry.isFile()) continue
    const file = `packages/editor/src/${relative(coreSourceDirectory, path).split(sep).join('/')}`
    sourceFiles.set(file, path)
  }
  const hash = createHash('sha256')
  for (const file of [...sourceFiles.keys()].sort()) {
    if (!/\.(ts|mjs|css|html)$/.test(file) || file.includes('/test/') || file.includes('/results/'))
      continue
    hash.update(file).update(await readFile(sourceFiles.get(file)))
  }
  return hash.digest('hex')
}
