import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../apps/web/src')
const testSuffix = /\.(?:test|spec|browser|test-d)\.[cm]?[jt]sx?$/
const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(filename)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [filename] : []
  })
}

function modulePath(filename) {
  return filename.replace(/\.[cm]?[jt]sx?$/, '')
}

function resolveImport(specifier, filename) {
  if (specifier.startsWith('@/')) return modulePath(path.join(root, specifier.slice(2)))
  if (specifier.startsWith('.')) return modulePath(path.resolve(path.dirname(filename), specifier))
  return specifier
}

function bucket(filename) {
  const relative = path.relative(root, filename).replaceAll('\\', '/')
  const parts = relative.split('/')
  if (parts[0] === 'features') return parts.slice(0, 2).join('/')
  return parts[0]
}

const edges = sourceFiles(root).flatMap((filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  return [...source.matchAll(imports)].map((match) => ({
    filename,
    target: resolveImport(match[1], filename),
    test: testSuffix.test(filename),
  }))
})

const rows = process.argv.slice(2).map((specifier) => {
  const target = resolveImport(specifier, path.join(root, 'main.tsx'))
  const consumers = edges.filter(
    (edge) => edge.target === target && modulePath(edge.filename) !== target,
  )
  const production = consumers.filter((edge) => !edge.test)
  const files = [...new Set(production.map((edge) => path.relative(root, edge.filename)))].sort()
  const buckets = [...new Set(production.map((edge) => bucket(edge.filename)))].sort()
  return {
    module: specifier,
    importLines: production.length,
    buckets,
    outsideLibBuckets: buckets.filter((name) => name !== 'lib'),
    files,
    testFiles: [
      ...new Set(
        consumers.filter((edge) => edge.test).map((edge) => path.relative(root, edge.filename)),
      ),
    ].sort(),
  }
})
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
