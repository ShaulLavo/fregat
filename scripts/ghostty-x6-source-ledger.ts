import assert from 'node:assert/strict'
import { parseSync } from 'oxc-parser'

export interface SourceSite {
  readonly id: string
  readonly file: string
  readonly kind: string
  readonly start: number
  readonly end: number
  readonly line: number
  readonly text: string
}

interface Marker {
  readonly at: number
  readonly text: string
  readonly open: boolean
  readonly length: number
  readonly terminator?: boolean
}

const expressions = new Set([
  'ArrayExpression',
  'ObjectExpression',
  'NewExpression',
  'ArrowFunctionExpression',
  'CallExpression',
])
const statements = new Set([
  'ExpressionStatement',
  'ReturnStatement',
  'ThrowStatement',
  'BreakStatement',
  'ContinueStatement',
])

export function instrumentSource(file: string, source: string) {
  const parsed = parseSync(file, source)
  assert.equal(parsed.errors.length, 0, file)
  const sites: SourceSite[] = []
  const markers: Marker[] = []
  collect(parsed.program, false, undefined, source, file, sites, markers)
  assert.equal(new Set(sites.map((site) => site.id)).size, sites.length)
  for (const site of sites) {
    markers.push({
      at: site.start,
      text: `(__x6Count(${JSON.stringify(site.id)}), (`,
      open: true,
      length: site.end - site.start,
    })
    markers.push({ at: site.end, text: '))', open: false, length: site.end - site.start })
  }
  markers.sort(
    (a, b) =>
      b.at - a.at ||
      Number(b.terminator ?? false) - Number(a.terminator ?? false) ||
      Number(a.open) - Number(b.open) ||
      a.length - b.length,
  )
  let transformed = source
  for (const marker of markers)
    transformed = transformed.slice(0, marker.at) + marker.text + transformed.slice(marker.at)
  const prefix = `function __x6Count(site: string): void {
    const counts = (globalThis as typeof globalThis & { __x6Owned?: Record<string, number> }).__x6Owned
    if (counts) counts[site] = (counts[site] ?? 0) + 1
  }\n`
  return { source: prefix + transformed, sites }
}

function collect(
  value: unknown,
  chain: boolean,
  parentType: string | undefined,
  source: string,
  file: string,
  sites: SourceSite[],
  markers: Marker[],
): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const child of value) collect(child, chain, parentType, source, file, sites, markers)
    return
  }
  const node = value as Record<string, unknown>
  const type = String(node.type)
  const start = Number(node.start)
  const end = Number(node.end)
  const text = source.slice(start, end)
  const optional = type === 'ChainExpression'
  const expression = expressions.has(type) && !(chain && type === 'CallExpression')
  const functionExpression = type === 'FunctionExpression' && /^(?:async\s+)?function\b/.test(text)
  if (optional || expression || functionExpression) {
    const kind = optional ? 'OptionalChainEvaluation' : type
    sites.push({
      id: `${file}|${kind}@${start}:${end}`,
      file,
      kind,
      start,
      end,
      line: source.slice(0, start).split('\n').length,
      text,
    })
  }
  const variableStatement = type === 'VariableDeclaration' && !parentType?.startsWith('For')
  // Leading parentheses on a wrapped expression must preserve original ASI statement boundaries.
  if ((statements.has(type) || variableStatement) && !text.trimEnd().endsWith(';'))
    markers.push({ at: end, text: ';', open: false, length: 0, terminator: true })
  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue
    collect(child, chain || optional, type, source, file, sites, markers)
  }
}
