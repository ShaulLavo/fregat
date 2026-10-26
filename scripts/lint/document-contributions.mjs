import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

const root = fileURLToPath(new URL('../../', import.meta.url))
const externalPackageRoots = [
  'packages/singapore/',
  'packages/ghostty-webgpu/',
  'packages/hotkeys/',
]
const viewObservers = new Map([
  [
    'apps/web/src/features/editor/hooks/use-document-feature-tier.ts',
    'synchronous feature-size policy',
  ],
  [
    'apps/web/src/features/editor/state/language-server-documents.ts',
    'size barrier retires retained protocol ownership',
  ],
  [
    'apps/web/src/features/editor/state/workspace-document-service.ts',
    'workspace dirty and revision publication',
  ],
  [
    'apps/web/src/features/workbench/components/csv-history-action.tsx',
    'synchronous history button state',
  ],
  ['apps/web/src/features/workbench/components/csv-table.tsx', 'synchronous CSV view'],
  [
    'apps/web/src/features/workbench/components/markdown-preview-pane.tsx',
    'synchronous preview demand',
  ],
  [
    'apps/web/src/features/workbench/hooks/use-editor-visible-snapshot.ts',
    'dirty-state invalidation of visible snapshot cache',
  ],
])

function* syntaxNodes(program) {
  const pending = [program]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      pending.push(...node)
      continue
    }
    if (typeof node.type === 'string') yield node
    pending.push(...Object.values(node))
  }
}

function staticName(node) {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'Literal') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked
  return null
}

function sourceTarget(filename, specifier) {
  return specifier.startsWith('.')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier))
    : specifier
}

function importFindings(node, filename) {
  const specifier = staticName(node.source)
  if (typeof specifier !== 'string') return []
  const target = sourceTarget(filename, specifier)
  if (!target.startsWith('@singapore-editor/')) return []
  const findings = []
  if (/^@singapore-editor\/[^/]+\/(?:src|dist)(?:\/|$)/.test(target))
    findings.push('Use an exported package entry point')
  if (target === '@singapore-editor/core/internal/document-worker')
    findings.push('Document worker internals belong to the editor package')
  return findings
}

export function documentContributionFindings(source, filename) {
  const parsed = parseSync(filename, source)
  if (parsed.errors.length)
    throw new SyntaxError(`Cannot parse ${filename}: ${parsed.errors[0].message}`)
  const findings = []
  const buffers = bufferAliases(parsed.program)
  const report = (node, message) =>
    findings.push({ line: source.slice(0, node.start).split('\n').length, message })
  for (const node of syntaxNodes(parsed.program)) {
    for (const message of importFindings(node, filename)) report(node, message)
    for (const binding of cursorBindings(node))
      report(binding, 'Generic document progress belongs to canonical delivery')
    for (const binding of subscriptionBindings(node, buffers, filename))
      report(binding, 'Retain document source through its contribution owner')
    if (node.type !== 'MemberExpression') continue
    const name = staticName(node.property)
    if (name === 'changesSinceDocumentSyncPoint')
      report(node, 'Generic document progress belongs to canonical delivery')
    const receiver = node.object
    const buffer = isBuffer(receiver, buffers)
    if (name === 'subscribe' && buffer && !permitsBufferObserver(filename))
      report(node, 'Retain document source through its contribution owner')
  }
  return findings
}

function isBuffer(node, aliases) {
  return (
    (node?.type === 'Identifier' && aliases.has(node.name)) ||
    (node?.type === 'MemberExpression' && staticName(node.property) === 'buffer')
  )
}

function bufferAliases(program) {
  const aliases = new Set(['buffer'])
  const nodes = [...syntaxNodes(program)]
  const factories = new Set(['createEditorTextBuffer'])
  for (const node of nodes) addBufferFactory(node, factories)
  const declarations = nodes.filter((node) => node.type === 'VariableDeclarator')
  let changed = true
  while (changed) {
    const before = aliases.size + factories.size
    for (const node of declarations) addBufferAlias(node, aliases, factories)
    changed = aliases.size + factories.size !== before
  }
  return aliases
}

function addBufferFactory(node, factories) {
  if (node.type !== 'ImportDeclaration') return
  for (const binding of node.specifiers) {
    if (staticName(binding.imported) === 'createEditorTextBuffer') factories.add(binding.local.name)
  }
}

function createsBuffer(node, factories) {
  if (node?.type !== 'CallExpression') return false
  return (
    factories.has(staticName(node.callee)) ||
    (node.callee.type === 'MemberExpression' &&
      staticName(node.callee.property) === 'createEditorTextBuffer')
  )
}

function addBufferAlias(node, aliases, factories) {
  if (node.id.type === 'Identifier' && factories.has(staticName(node.init))) {
    factories.add(node.id.name)
    return
  }
  if (
    node.id.type === 'Identifier' &&
    (isBuffer(node.init, aliases) || createsBuffer(node.init, factories))
  ) {
    aliases.add(node.id.name)
    return
  }
  if (node.id.type !== 'ObjectPattern') return
  for (const binding of node.id.properties) {
    if (staticName(binding.key) === 'buffer' && binding.value?.type === 'Identifier')
      aliases.add(binding.value.name)
  }
}

function permitsBufferObserver(filename) {
  return viewObservers.has(filename)
}

function subscriptionBindings(node, buffers, filename) {
  if (
    node.type !== 'VariableDeclarator' ||
    node.id.type !== 'ObjectPattern' ||
    permitsBufferObserver(filename)
  )
    return []
  if (!isBuffer(node.init, buffers)) return []
  return node.id.properties.filter((binding) => staticName(binding.key) === 'subscribe')
}

function cursorBindings(node) {
  if (node.type !== 'ObjectPattern') return []
  return node.properties.filter(
    (binding) => staticName(binding.key) === 'changesSinceDocumentSyncPoint',
  )
}

function productionSource(filename) {
  if (externalPackageRoots.some((directory) => filename.startsWith(directory))) return false
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(filename)) return false
  if (/\.(?:test|browser)\./.test(filename)) return false
  return !/(?:^|\/)(?:node_modules|dist|generated|test|tests|e2e|results)\//.test(filename)
}

function check() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'apps', 'packages'],
    { cwd: root, encoding: 'utf8' },
  ).split('\0')
  const findings = []
  for (const filename of new Set(files)) {
    if (!productionSource(filename)) continue
    const absolute = path.join(root, filename)
    if (!existsSync(absolute)) continue
    for (const finding of documentContributionFindings(readFileSync(absolute, 'utf8'), filename))
      findings.push(`${filename}:${finding.line}: ${finding.message}`)
  }
  if (!findings.length) return console.log('document contribution gate: ownership boundaries pass')
  console.error(findings.join('\n'))
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check()
