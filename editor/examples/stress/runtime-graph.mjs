import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'

/** Records every module the main and worker bundles actually parse. */
export function recordModules(ids) {
  return {
    name: 'stress-runtime-graph',
    moduleParsed(info) {
      ids.add(info.id)
    },
  }
}

const inside = (root, path) => path === root || path.startsWith(root + sep)
const codeExtensions = new Set(['.js', '.mjs', '.css', '.html', '.map'])

async function files(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
}

// Chained package maps can name a file at the wrong directory depth. Such a path is rebased onto the
// allowed root whose directory name it contains, and only a file that exists there counts.
async function existingSource(path, roots) {
  if (await stat(path).catch(() => null)) return path
  for (const root of roots) {
    const marker = `${sep}${basename(root)}${sep}`
    const at = path.lastIndexOf(marker)
    if (at < 0) continue
    const rebased = resolve(root, path.slice(at + marker.length))
    if (await stat(rebased).catch(() => null)) return rebased
  }
  return path
}

const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

// Modules and copied assets must resolve to the bytes covered by their source receipts.
export async function verifyRuntimeGraph({
  ids,
  outDir,
  instrumentRoot,
  packageSetDirectory,
  receiptRoots,
}) {
  const instrument = await realpath(instrumentRoot)
  const frozen = await realpath(packageSetDirectory)
  const roots = await Promise.all(receiptRoots.map((root) => realpath(root)))
  const manifest = JSON.parse(await readFile(resolve(frozen, 'package-set.json'), 'utf8'))
  const folders = new Set(manifest.packages.map((entry) => entry.folder))
  const receiptRoot = (path) =>
    roots.find(
      (root) => inside(root, path) && !relative(root, path).split(sep).includes('node_modules'),
    )
  const frozenFile = (path) => {
    if (!inside(frozen, path)) return false
    const [folder, section, ...rest] = relative(frozen, path).split(sep)
    return (
      folders.has(folder) &&
      ((section === 'package.json' && rest.length === 0) ||
        (['src', 'dist'].includes(section) && rest.length > 0))
    )
  }
  const allowed = (path) =>
    (inside(instrument, path) && !relative(instrument, path).split(sep).includes('node_modules')) ||
    frozenFile(path) ||
    Boolean(receiptRoot(path))
  const escaped = []
  const usedRoots = new Set()
  let modules = 0
  // Worker bundles do not run the recording hook; their hidden source maps name every module.
  const sources = new Set(ids)
  for (const map of (await files(outDir)).filter((path) => path.endsWith('.map'))) {
    const { sourceRoot = '', sources: mapped = [] } = JSON.parse(await readFile(map, 'utf8'))
    for (const source of mapped)
      sources.add(
        await existingSource(resolve(dirname(map), sourceRoot, source), [frozen].concat(roots)),
      )
  }
  for (const id of sources) {
    const path = id.split('?')[0]
    if (id.startsWith('\0') || !path.startsWith('/')) continue
    const real = await realpath(path).catch(() => path)
    modules++
    if (!allowed(real)) escaped.push(real)
    const root = receiptRoot(real)
    if (root) usedRoots.add(root)
  }
  const assets = []
  // Binary assets, and scripts copied without a map (prebuilt package workers), must be exact copies.
  const output = await files(outDir)
  const mapped = new Set(
    output.filter((path) => path.endsWith('.map')).map((path) => path.slice(0, -4)),
  )
  const emitted = output.filter(
    (path) =>
      !codeExtensions.has(extname(path)) ||
      (['.js', '.mjs'].includes(extname(path)) && !mapped.has(path)),
  )
  if (emitted.length) {
    const sizes = new Map()
    for (const path of emitted) sizes.set((await stat(path)).size, [])
    for (const root of [frozen].concat(roots)) {
      for (const path of await files(root)) {
        const real = await realpath(path)
        if (!allowed(real)) continue
        const size = (await stat(path)).size
        if (sizes.has(size)) sizes.get(size).push(path)
      }
    }
    for (const path of emitted) {
      const hash = await sha256(path)
      const candidates = sizes.get((await stat(path)).size)
      let source = null
      for (const candidate of candidates)
        if ((await sha256(candidate)) === hash) source ??= candidate
      assets.push({ file: relative(outDir, path), sha256: hash, source })
      if (!source) escaped.push(`asset ${relative(outDir, path)}`)
    }
  }
  const receiptPackagesUsed = await Promise.all(
    Array.from(
      usedRoots,
      async (root) => JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).name,
    ),
  )
  return { modules, receiptPackagesUsed: receiptPackagesUsed.sort(), assets, escaped }
}
