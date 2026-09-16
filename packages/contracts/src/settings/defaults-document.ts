import { descriptorFor, SETTING_IDS, type SettingId } from './keys'
import type { SettingDescriptor, SettingScope } from './registry'

/**
 * Identifies the generated document where a layer file would carry a revision.
 * The registry is code, so it changes only with the build.
 */
export const DEFAULT_SETTINGS_DOCUMENT_REVISION = 'registry'

const SCOPE_NOTES: Readonly<Record<SettingScope, string>> = {
  application: 'user settings only',
  machine: 'user settings only, machine-specific',
  window: 'user or workspace settings',
  resource: 'user or workspace settings',
}

const COMMENT_WIDTH = 96
const INDENT = '  '

/**
 * The registry rendered as a commented JSON document: every key, its default,
 * and where it may be set.
 *
 * Generated on request and never written to disk. A defaults file would be a
 * copy of the registry that goes stale across builds, and a stale default in a
 * file is indistinguishable from a value someone chose.
 */
export function defaultSettingsDocument(): string {
  const lines = [
    '// Every setting this build knows about, with its default value.',
    '// Generated from the registry; it cannot be edited. Set a key in your user',
    '// settings (or workspace settings, where the scope allows it) to override it.',
    '{',
  ]
  let category: string | null = null

  SETTING_IDS.forEach((id, index) => {
    const descriptor = descriptorFor(id)
    if (index > 0) lines.push('')
    if (descriptor.category !== category) {
      category = descriptor.category
      lines.push(`${INDENT}// ── ${category} ──`)
    }
    lines.push(...entryLines(id, descriptor, index === SETTING_IDS.length - 1))
  })

  lines.push('}', '')

  return lines.join('\n')
}

function entryLines(id: SettingId, descriptor: SettingDescriptor, last: boolean): string[] {
  const comment = [...wrap(descriptor.description), ...provenance(descriptor)]
  const value = JSON.stringify(descriptor.default, null, INDENT.length)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${INDENT}${line}`))
    .join('\n')

  return [
    ...comment.map((line) => `${INDENT}// ${line}`),
    `${INDENT}${JSON.stringify(id)}: ${value}${last ? '' : ','}`,
  ]
}

function provenance(descriptor: SettingDescriptor): string[] {
  const lines = [`Scope: ${descriptor.scope} (${SCOPE_NOTES[descriptor.scope]}).`]
  if (descriptor.requiresRestart) lines.push('Takes effect after a restart.')
  if (descriptor.readOnlyReason) lines.push(`Read-only: ${descriptor.readOnlyReason}`)
  if (descriptor.deprecationReason) lines.push(`Deprecated: ${descriptor.deprecationReason}`)

  return lines
}

function wrap(text: string): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      if (line.length > 0 && line.length + word.length + 1 > COMMENT_WIDTH) {
        lines.push(line)
        line = word
        continue
      }
      line = line.length === 0 ? word : `${line} ${word}`
    }
    lines.push(line)
  }

  return lines
}
