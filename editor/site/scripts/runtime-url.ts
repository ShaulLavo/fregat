import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'

const name = 'virtual:example-editor-url'
const id = `\0${name}`

/** Emit a runtime URL so a deliberate retry can bypass the browser's failed module record. */
export function exampleRuntimeUrl(): Plugin {
  let development = false
  let base = '/'
  return {
    name: 'singapore-example-runtime-url',
    configResolved(config) {
      development = config.command === 'serve'
      base = config.base
    },
    resolveId(source) {
      if (source === name) return id
    },
    load(source) {
      if (source !== id) return
      if (development)
        return `export default ${JSON.stringify(`${base}src/manual/example-editor.ts`)}`
      const ref = this.emitFile({
        type: 'chunk',
        id: fileURLToPath(new URL('../src/manual/example-editor.ts', import.meta.url)),
        name: 'example-editor',
      })
      return `export default import.meta.ROLLUP_FILE_URL_${ref}`
    },
  }
}
