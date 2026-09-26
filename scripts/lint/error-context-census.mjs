import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { contrastPhrase } from '../../packages/utils/src/copy.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALLOW = 'scripts/lint/error-context-allow.json'
const EXCLUDED = /(?:\/tests?\/|\.(?:test|spec|browser|test-d)\.|\/generated\/|node_modules\/)/

/**
 * A catalog entry whose `message` is a constant string carries no runtime
 * information: thrown bare, it puts a code and a stack in the log and nothing
 * else. Those sites have to attach `internal`, which is the slot evlog keeps
 * out of HTTP responses and our logger writes to the wide event.
 *
 * An entry with a templated message already names its own facts, so it is not
 * measured here.
 */
function sourceFiles() {
  const output = execFileSync('git', ['ls-files', 'apps', 'packages'], { cwd: ROOT }).toString()
  return output
    .split('\n')
    .filter((file) => /\.(?:ts|tsx)$/.test(file) && !EXCLUDED.test(file))
    .map((file) => path.join(ROOT, file))
    .filter((file) => existsSync(file))
}

function parse(file) {
  const text = readFileSync(file, 'utf8')
  return { text, program: parseSync(file, text).program }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node.type === 'string') visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    walk(value, visit)
  }
}

/** `defineErrorCatalog('x', { CODE: { message: 'constant' } })` entries. */
function constantMessageCodes(program) {
  const codes = new Set()
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return
    if (node.callee?.name !== 'defineErrorCatalog') return
    const map = node.arguments?.[1]
    if (map?.type !== 'ObjectExpression') return
    for (const entry of map.properties) {
      if (entry.type !== 'Property' || entry.value?.type !== 'ObjectExpression') continue
      const message = entry.value.properties.find(
        (property) => property.type === 'Property' && propertyName(property) === 'message',
      )
      if (message?.value?.type !== 'Literal') continue
      codes.add(propertyName(entry))
    }
  })
  return codes
}

/**
 * `message`, `why` and `fix` reach the user's toast, so the Copy rule applies to
 * them: each catalog entry's text is checked for contrast phrasing.
 */
function copyFindings(program, text, file) {
  const findings = []
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return
    if (node.callee?.name !== 'defineErrorCatalog') return
    const map = node.arguments?.[1]
    if (map?.type !== 'ObjectExpression') return
    for (const entry of map.properties) {
      if (entry.type !== 'Property' || entry.value?.type !== 'ObjectExpression') continue
      for (const property of entry.value.properties) {
        const field = property.type === 'Property' ? propertyName(property) : null
        if (field !== 'message' && field !== 'why' && field !== 'fix') continue
        const phrase = contrastPhrase(literalText(property.value))
        if (!phrase) continue
        findings.push(
          `${path.relative(ROOT, file)}:${lineOf(text, property.start)} ${propertyName(entry)}.${field}: "${phrase}"`,
        )
      }
    }
  })
  return findings
}

/** A string literal's text, or a template's static parts joined by a space. */
function literalText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral')
    return node.quasis.map((quasi) => quasi.value.cooked).join(' ')
  if (node?.type === 'ArrowFunctionExpression') return literalText(node.body)
  return ''
}

function propertyName(property) {
  return property.key?.name ?? property.key?.value
}

/** `xErrors.CODE(...)` calls, with whether the argument object names `internal`. */
function throwSites(program) {
  const sites = []
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    if (callee?.type !== 'MemberExpression') return
    if (!/Errors$/.test(callee.object?.name ?? '')) return

    const code = callee.property?.name
    if (!code || !/^[A-Z][A-Z0-9_]*$/.test(code)) return
    sites.push({ code, hasInternal: namesInternal(node.arguments?.[0]), start: node.start })
  })
  return sites
}

function namesInternal(argument) {
  if (argument?.type !== 'ObjectExpression') return false
  return argument.properties.some(
    (property) =>
      (property.type === 'Property' && propertyName(property) === 'internal') ||
      property.type === 'SpreadElement',
  )
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function collect() {
  const files = sourceFiles()
  const constantCodes = new Set()
  const parsed = new Map()
  for (const file of files) {
    const entry = parse(file)
    parsed.set(file, entry)
    for (const code of constantMessageCodes(entry.program)) constantCodes.add(code)
  }

  const findings = []
  const copy = []
  let measured = 0
  for (const [file, { text, program }] of parsed) {
    copy.push(...copyFindings(program, text, file))
    for (const site of throwSites(program)) {
      if (!constantCodes.has(site.code)) continue
      measured += 1
      if (site.hasInternal) continue
      findings.push({
        key: `${path.relative(ROOT, file)}:${site.code}`,
        line: lineOf(text, site.start),
      })
    }
  }
  return { copy, findings, measured }
}

function allowances() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, ALLOW), 'utf8'))
  } catch {
    return {}
  }
}

const { copy, findings, measured } = collect()
const allowed = allowances()
const unexcused = findings.filter((finding) => !allowed[finding.key]?.trim())
const stale = Object.keys(allowed).filter((key) => !findings.some((finding) => finding.key === key))

if (process.argv.includes('--write')) {
  const next = Object.fromEntries(
    findings.map((finding) => [finding.key, allowed[finding.key] ?? 'TODO: say why']),
  )
  writeFileSync(path.join(ROOT, ALLOW), `${JSON.stringify(next, null, 2)}\n`)
  console.log(`wrote ${ALLOW} with ${findings.length} entries`)
  process.exit(0)
}

console.log(`error context census: ${measured} constant-message throw sites`)
console.log(`  with runtime context: ${measured - findings.length}`)
console.log(
  `  bare:                 ${findings.length} (${findings.length - unexcused.length} excused)`,
)

for (const finding of unexcused) console.log(`  ${finding.key} (line ${finding.line})`)
for (const key of stale) console.log(`  stale allowance: ${key}`)

console.log(`error catalog copy: ${copy.length} contrast phrases`)
for (const finding of copy) console.log(`  ${finding}`)

if (!process.argv.includes('--check')) process.exit(0)
if (unexcused.length === 0 && stale.length === 0 && copy.length === 0) {
  console.log(
    'gate: every constant-message error carries runtime context; catalog copy says what things are',
  )
  process.exit(0)
}
if (copy.length > 0)
  console.log('gate: catalog text reaches the toast; say what a thing is and does (AGENTS.md Copy)')
if (unexcused.length > 0 || stale.length > 0) {
  console.log('gate: a constant-message error thrown bare logs only its code')
}
process.exit(1)
