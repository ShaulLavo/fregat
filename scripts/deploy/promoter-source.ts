import path from 'node:path'
import { createScriptError } from '../structured-errors'

/** One standalone payload serves both machine installation and the mesh unit. */
export async function buildPromoterSource(
  entry = path.join(import.meta.dirname, 'systemd', 'promote.ts'),
) {
  const build = await Bun.build({ entrypoints: [entry], target: 'bun', minify: false })
  if (!build.success || build.outputs.length !== 1)
    throw createScriptError(
      `The release promoter could not be bundled (success=${build.success}, outputs=${build.outputs.length}).`,
    )
  return build.outputs[0]!.text()
}
