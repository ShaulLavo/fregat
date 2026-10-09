import { createRequire } from 'node:module'
import path from 'node:path'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')

// Resolve each app's OXC compiler for its Vite/dev transforms; another version can report
// different bailouts. The TUI release build uses Bun's compiler in client mode.
const { transformSync } = createRequire(path.join(REPOSITORY, 'apps/web/package.json'))(
  'oxc-transform-react',
)
const { transformSync: transformTui } = createRequire(
  path.join(REPOSITORY, 'apps/tui/package.json'),
)('oxc-transform-react')

/**
 * The build's output plus every bailout. The compiler drops recoverable bailouts unless
 * `all_errors` makes them fatal, and a fatal pass emits no code, so the two come from two passes.
 */
export function compileLikeBuild(file, source) {
  const tui = path
    .resolve(REPOSITORY, file)
    .startsWith(path.join(REPOSITORY, 'apps/tui') + path.sep)
  const compile = tui ? transformTui : transformSync
  const options = {
    jsx: {
      runtime: /** @type {const} */ ('automatic'),
      importSource: tui ? '@opentui/react' : 'react',
    },
  }
  const built = compile(file, source, { ...options, reactCompiler: {} })
  const checked = compile(file, source, {
    ...options,
    reactCompiler: { panicThreshold: 'all_errors' },
  })
  return { code: built.code, errors: built.errors.concat(checked.errors) }
}
