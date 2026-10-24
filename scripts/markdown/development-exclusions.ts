import { hash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { array, literal, number, object, parse, pipe, regex, string } from 'valibot'
import { createScriptError } from '../structured-errors'
import { encoded } from './serialization'

const policySchema = object({
  schemaVersion: literal(1),
  matching: literal('utf16-prefix-any-suffix-v1'),
  rules: array(
    object({
      id: string(),
      prefix: string(),
      suffix: string(),
      provenance: object({
        commit: pipe(string(), regex(/^[a-f0-9]{40}$/u)),
        path: string(),
        gitBlob: pipe(string(), regex(/^[a-f0-9]{40}$/u)),
        fileSha256: pipe(string(), regex(/^[a-f0-9]{64}$/u)),
        line: number(),
        expression: string(),
        bindings: array(string()),
      }),
    }),
  ),
})
function policyFiles(root?: string) {
  const directory = root ? path.join(root, 'scripts/markdown/') : new URL('./', import.meta.url)
  const file = (name: string) =>
    typeof directory === 'string' ? path.join(directory, name) : new URL(name, directory)
  return {
    policy: parse(
      policySchema,
      JSON.parse(readFileSync(file('development-exclusion-policy.json'), 'utf8')),
    ),
    matcherSha256: hash('sha256', readFileSync(file('development-exclusions.ts'))),
  }
}
const current = policyFiles()
export const DEVELOPMENT_POLICY = current.policy
export const DEVELOPMENT_POLICY_SHA256 = hash('sha256', encoded(current))

export function requireDevelopmentPolicy(root: string, expected: string) {
  if (
    expected !== DEVELOPMENT_POLICY_SHA256 ||
    hash('sha256', encoded(policyFiles(root))) !== expected
  )
    throw createScriptError(
      'Development exclusion policy requires the frozen matching rules and provenance.',
      {
        internal: { boundary: 'development-policy-identity' },
      },
    )
}

export function runtimeSourceExcluded(source: string) {
  return DEVELOPMENT_POLICY.rules.some(
    ({ prefix, suffix }) =>
      source.length >= prefix.length + suffix.length &&
      source.startsWith(prefix) &&
      source.endsWith(suffix),
  )
}
