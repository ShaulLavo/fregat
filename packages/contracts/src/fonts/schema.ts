import * as v from 'valibot'

import { parseFontRef } from './ref'

export const fontRefSchema = v.pipe(
  v.string(),
  v.minLength(3),
  v.maxLength(160),
  v.check(
    (value) => parseFontRef(value) !== null,
    'Expected a font reference: bundled:<id>, nerd:<id>, fontsource:<id> or local:<family>',
  ),
)
