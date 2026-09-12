import type { VscodeThemeRegistration } from '@singapor/core/shiki'

import { fnv1a32 } from '@workspace/client-core/address/path-hash'

/** Stable FNV-1a fingerprint for logs and semantic subscription comparisons. */
export function shikiThemeContentHash(
  themeId: string,
  registration?: VscodeThemeRegistration,
): string {
  const content = registration ? JSON.stringify(registration) : `name:${themeId}`
  return (fnv1a32(content) >>> 0).toString(16).padStart(8, '0')
}
