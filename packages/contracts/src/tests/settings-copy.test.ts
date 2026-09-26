import { describe, expect, it } from 'vitest'
import { contrastPhrase } from '@workspace/utils/copy'
import { SETTINGS_REGISTRY } from '../settings/keys'

// Every registry field the settings page, schema hover or reference shows as text.
const COPY_FIELDS = [
  'description',
  'details',
  'title',
  'readOnlyReason',
  'deprecationReason',
] as const

describe('settings registry copy', () => {
  it('describes every setting by what it is and does', () => {
    const contrasts = Object.entries(SETTINGS_REGISTRY).flatMap(([id, descriptor]) =>
      COPY_FIELDS.flatMap((field) => {
        const text: string | undefined = descriptor[field]
        const phrase = text === undefined ? null : contrastPhrase(text)

        return phrase === null ? [] : [`${id} ${field}: "${phrase}"`]
      }),
    )

    expect(contrasts).toEqual([])
  })
})
