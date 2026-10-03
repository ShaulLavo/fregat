import { describe, expect, it } from 'vitest'
import { contrastPhrase } from '@workspace/utils/copy'
import { SETTING_IDS } from '../settings/keys'
import { presentSetting } from '../settings/documentation'

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
    const contrasts = SETTING_IDS.flatMap((id) =>
      COPY_FIELDS.flatMap((field) => {
        const text: string | undefined = presentSetting(id)[field]
        const phrase = text === undefined ? null : contrastPhrase(text)

        return phrase === null ? [] : [`${id} ${field}: "${phrase}"`]
      }),
    )

    expect(contrasts).toEqual([])
  })
})
