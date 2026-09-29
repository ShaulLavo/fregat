import type { TypeScriptLspPlugin, TypeScriptLspPluginOptions } from './types'
import { createTypeScriptLspPlugin as createBaseTypeScriptLspPlugin } from './plugin'
import { createTypeScriptLspWorkerOwner } from './workerOwner'

export function createTypeScriptLspPlugin(
  options: TypeScriptLspPluginOptions = {},
): TypeScriptLspPlugin {
  return createBaseTypeScriptLspPlugin({
    ...options,
    // The owner's own onError stays unset: the connection reports the crash, with its reason.
    workerFactory: () => createTypeScriptLspWorkerOwner({ workerFactory: options.workerFactory }),
  })
}
