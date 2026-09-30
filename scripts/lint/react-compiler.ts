import { createRequire } from 'node:module'
import type { transformSync as transform } from 'oxc-transform-react'
import path from 'node:path'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')

// Loaded from apps/web, where it is installed unhoisted: the census must run the exact compiler
// the build runs, because another version reports a different set of bailouts.
const { transformSync }: { transformSync: typeof transform } = createRequire(
  path.join(REPOSITORY, 'apps/web/package.json'),
)('oxc-transform-react')

/**
 * The build's output plus every bailout. The compiler drops recoverable bailouts unless
 * `all_errors` makes them fatal, and a fatal pass emits no code, so the two come from two passes.
 */
export function compileLikeBuild(file: string, source: string) {
  const options = { jsx: { runtime: 'automatic' as const } }
  const built = transformSync(file, source, { ...options, reactCompiler: {} })
  const checked = transformSync(file, source, {
    ...options,
    reactCompiler: { panicThreshold: 'all_errors' },
  })
  return { code: built.code, errors: [...built.errors, ...checked.errors] }
}
