import path from 'node:path'
import { transform } from 'oxc-transform-react'

import { createTuiError } from '../src/host/utils/structured-errors.ts'

const root = path.resolve(import.meta.dirname, '..')
const roots = [path.join(root, 'src') + path.sep, path.join(root, 'test') + path.sep]
export const tuiSources = new RegExp(
  `^(?:${roots.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}).*\\.tsx?$`,
)

export async function compileTui(file: string, source: string) {
  const result = await transform(file, source, {
    jsx: { runtime: 'automatic', importSource: '@opentui/react' },
    reactCompiler: {},
    sourcemap: true,
  })
  if (result.fatal) {
    throw createTuiError(
      'The React Compiler could not compile a terminal component.',
      'Run bun run compiler:census to inspect the compiler diagnostics.',
    )
  }
  return { code: result.code, map: result.map }
}
