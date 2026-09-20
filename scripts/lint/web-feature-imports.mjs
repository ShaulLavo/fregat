import fs from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import {
  importValue,
  importVisitors,
  isTest,
  resolvedImport,
  sourceLocation,
  webRelative,
} from './web-boundary-imports.mjs'

const allowances = new Map()
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
const REASON = /^(?:shared → lib|shared → contracts|owner|couple):\s*\S.+/

function existingModule(filename) {
  const candidates = [
    filename,
    ...EXTENSIONS.map((extension) => filename + extension),
    ...EXTENSIONS.map((extension) => path.join(filename, `index${extension}`)),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

function entryKey(entry) {
  return `${entry.from}:${entry.to}:${entry.module}`
}

export function featureImport(node, location) {
  const from = location.relative.match(/^features\/([^/]+)\//)?.[1]
  const source = importValue(node)
  if (!from || !source) return null
  const resolved = resolvedImport(source, location)
  const to = webRelative(resolved, location.root).match(/^features\/([^/]+)\//)?.[1]
  if (!to || from === to) return null
  const module = path
    .relative(path.join(location.root, 'apps/web/src'), existingModule(resolved) ?? resolved)
    .replaceAll('\\', '/')
  const entry = { from, to, module }
  return { ...entry, key: entryKey(entry) }
}

function featureSourceFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) return featureSourceFiles(filename)
    return /\.[cm]?[jt]sx?$/.test(filename) && !isTest(filename) ? [filename] : []
  })
}

function visitImports(node, visitors) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) visitImports(child, visitors)
    return
  }
  visitors[node.type]?.(node)
  for (const child of Object.values(node)) visitImports(child, visitors)
}

function featureImportKeys(root) {
  const keys = new Set()
  for (const filename of featureSourceFiles(path.join(root, 'apps/web/src/features'))) {
    const location = sourceLocation(filename)
    const parsed = parseSync(filename, fs.readFileSync(filename, 'utf8'))
    const visitors = importVisitors((node) => {
      const entry = featureImport(node, location)
      if (entry) keys.add(entry.key)
    })
    visitImports(parsed.program, visitors)
  }
  return keys
}

function entryProblems(entry, root, hits, seen) {
  if (!entry || typeof entry !== 'object') return ['Allow-list entry must be an object.']
  if (
    typeof entry.from !== 'string' ||
    typeof entry.to !== 'string' ||
    typeof entry.module !== 'string'
  )
    return ['Allow-list entry must name from, to and an exact module.']
  const key = entryKey(entry)
  const problems = []
  if (!REASON.test(entry.reason ?? ''))
    problems.push(
      `${key}: missing reason; explain owner, couple, shared → lib or shared → contracts.`,
    )
  if (seen.has(key)) problems.push(`${key}: duplicate allow-list entry.`)
  seen.add(key)
  const module = path.join(root, 'apps/web/src', entry.module)
  if (!entry.module.startsWith(`features/${entry.to}/`) || existingModule(module) !== module)
    problems.push(`${key}: missing exact module ${entry.module}.`)
  if (!hits.has(key)) problems.push(`${key}: stale allow-list entry; no production import uses it.`)
  return problems
}

export function readFeatureAllowance(root) {
  const cached = allowances.get(root)
  if (cached) return cached
  const filename = path.join(root, 'scripts/lint/web-feature-allow.json')
  const entries = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const keys = new Set()
  const hits = featureImportKeys(root)
  const problems = Array.isArray(entries)
    ? entries.flatMap((entry) => entryProblems(entry, root, hits, keys))
    : ['The feature allow-list must be an array.']
  const allowance = { keys, problems, reported: false }
  allowances.set(root, allowance)
  return allowance
}
