import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import { defaultSettingsDocument } from '../settings/defaults-document'
import { descriptorFor, SETTING_IDS } from '../settings/keys'

/** The document is JSONC with full-line comments only, so stripping them leaves JSON. */
function parsedDefaults(): Record<string, unknown> {
  const json = defaultSettingsDocument()
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

  return JSON.parse(json) as Record<string, unknown>
}

describe('defaultSettingsDocument', () => {
  it('renders every registry key with a default that round-trips through its schema', () => {
    const parsed = parsedDefaults()

    expect(Object.keys(parsed)).toEqual(SETTING_IDS)
    for (const id of SETTING_IDS) {
      const result = v.safeParse(descriptorFor(id).schema, parsed[id])
      expect(result.success, id).toBe(true)
      expect(parsed[id]).toEqual(descriptorFor(id).default)
    }
  })

  it('precedes each key with its description, scope and restart note', () => {
    const lines = defaultSettingsDocument().split('\n')

    for (const id of SETTING_IDS) {
      const at = lines.findIndex((line) => line.startsWith(`  ${JSON.stringify(id)}:`))
      expect(at, id).toBeGreaterThan(0)
      const comment = commentAbove(lines, at)
      const descriptor = descriptorFor(id)
      expect(comment, id).toContain(`// ${descriptor.description.split(' ')[0]}`)
      expect(comment, id).toMatch(new RegExp(`// Scope: ${descriptor.scope} \\(`))
      expect(comment.includes('// Takes effect after a restart.'), id).toBe(
        descriptor.requiresRestart === true,
      )
    }
  })
})

/** The contiguous comment lines directly above an entry. */
function commentAbove(lines: readonly string[], at: number): string {
  let start = at
  while (start > 0 && lines[start - 1]!.trimStart().startsWith('//')) start -= 1

  return lines.slice(start, at).join('\n')
}
