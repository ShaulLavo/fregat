// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import { FLATTENED_PREFIX } from './constants'

export const getSelectionPath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX) ? path.slice(FLATTENED_PREFIX.length) : path
