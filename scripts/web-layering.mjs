import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parseSync, Visitor } from 'oxc-parser'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { root: { type: 'string', default: path.resolve(import.meta.dirname, '../apps/web') } },
})
const root = path.resolve(values.root, 'src')
const testSuffix = /\.(?:test|spec|browser|test-d)\.[cm]?[jt]sx?$/

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

function isTest(filename) {
  const relative = path.relative(values.root, filename).replaceAll('\\', '/')
  return /(?:^|\/)(?:test|tests)\//.test(relative) || testSuffix.test(relative)
}

function importValue(node) {
  const source = node.source ?? node.arguments?.[0] ?? node.moduleReference?.expression
  if (typeof source?.value === 'string') return source.value
  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0)
    return source.quasis[0].value.cooked
  return null
}

function imports(source, filename) {
  const specifiers = []
  const add = (node) => {
    const specifier = importValue(node)
    if (specifier !== null) specifiers.push(specifier)
  }
  const visitor = new Visitor({
    ImportDeclaration: add,
    ExportNamedDeclaration: add,
    ExportAllDeclaration: add,
    ImportExpression: add,
    TSImportType: add,
    TSImportEqualsDeclaration: add,
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') add(node)
    },
  })
  visitor.visit(parseSync(filename, source).program)
  return specifiers
}

const testRoot = path.resolve(values.root, 'test')
const files = sourceFiles(root).concat(fs.existsSync(testRoot) ? sourceFiles(testRoot) : [])
const edges = files.flatMap((filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  return imports(source, filename).map((specifier) => ({
    filename,
    target: resolveImport(specifier, filename),
    test: isTest(filename),
  }))
})

const rows = positionals.map((specifier) => {
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
