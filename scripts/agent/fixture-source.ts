import { fileURLToPath } from 'node:url'
import { createScriptError } from '../structured-errors.ts'

/** Installed CLI fixtures need self-contained JavaScript for Node's extensionless executable loader. */
export async function fixtureSource(entrypoint: string | URL) {
  const build = await Bun.build({
    entrypoints: [entrypoint instanceof URL ? fileURLToPath(entrypoint) : entrypoint],
    target: 'node',
    format: 'esm',
  })
  if (!build.success) throw createScriptError('The native fixture could not be bundled')
  return build.outputs[0]!.text()
}
