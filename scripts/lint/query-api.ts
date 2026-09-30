import type { Node } from 'oxc-parser'
import { isNode } from './ast.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

const root = fileURLToPath(new URL('../../', import.meta.url))
const deprecated = new Set([
  'fetchQuery',
  'prefetchQuery',
  'ensureQueryData',
  'fetchInfiniteQuery',
  'prefetchInfiniteQuery',
  'ensureInfiniteQueryData',
])

function propertyName(node: Node | null, computed: boolean) {
  if (node?.type === 'Literal') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? null
  if (!computed && node?.type === 'Identifier') return node.name
  return null
}

function walk(
  node: unknown,
  parent: Node | null,
  visit: (node: Node, parent: Node | null) => void,
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent, visit)
    return
  }
  if (!isNode(node)) return
  visit(node, parent)
  for (const child of Object.values(node)) walk(child, node, visit)
}

export function deprecatedQueryAccesses(source: string, filename = 'source.ts') {
  const result = parseSync(filename, source)
  if (result.errors.length) throw new Error(`Cannot parse ${filename}: ${result.errors[0].message}`)
  const findings: { name: string; line: number }[] = []
  walk(result.program, null, (node, parent) => {
    let name = null
    if (node.type === 'MemberExpression') name = propertyName(node.property, node.computed)
    if (node.type === 'Property' && parent?.type === 'ObjectPattern')
      name = propertyName(node.key, node.computed)
    if (typeof name !== 'string' || !deprecated.has(name)) return
    findings.push({ name, line: source.slice(0, node.start).split('\n').length })
  })
  return findings
}

function check() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'apps', 'packages', 'scripts'],
    { cwd: root, encoding: 'utf8' },
  ).split('\n')
  const findings: string[] = []
  for (const file of new Set(files)) {
    if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) continue
    if (/(?:^|\/)(?:node_modules|dist|generated|vendor)\//.test(file)) continue
    const absolute = path.join(root, file)
    if (!existsSync(absolute)) continue
    for (const finding of deprecatedQueryAccesses(readFileSync(absolute, 'utf8'), file))
      findings.push(`${file}:${finding.line}: replace deprecated QueryClient.${finding.name}`)
  }
  if (!findings.length) return console.log('query API gate: no deprecated method access')
  console.error(findings.join('\n'))
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check()
