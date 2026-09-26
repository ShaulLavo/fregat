// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { ResolvedPathStoreOptions } from './internal-types'
import type { PathStoreOptions } from './public-types'

export function resolvePathStoreOptions(options: PathStoreOptions = {}): ResolvedPathStoreOptions {
  return {
    flattenEmptyDirectories: options.flattenEmptyDirectories !== false,
    sort: options.sort ?? 'default',
  }
}
