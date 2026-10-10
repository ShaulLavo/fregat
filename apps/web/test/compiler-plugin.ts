import path from 'node:path'
import { transformSync } from 'oxc-transform-react'
import { normalizePath, type Plugin } from 'vite'

const appSource = normalizePath(path.resolve(import.meta.dirname, '../src')) + '/'
const probe = normalizePath(path.resolve(import.meta.dirname, './factories/use-compiler-probe.ts'))

export function compilerPlugin(): Plugin {
  return {
    name: 'test:browser-react-compiler',
    enforce: 'pre',
    transform(source, id) {
      const file = id.split('?')[0]
      if (!file || !/\.[jt]sx?$/.test(file)) return
      if (!file.startsWith(appSource) && file !== probe) return

      // The SSR test environment keeps Bun/server resolution; browser modules still need
      // the app's installed OXC compiler, which plugin-react disables for server consumers.
      const result = transformSync(file, source, {
        jsx: { runtime: 'automatic' },
        reactCompiler: {},
        sourcemap: true,
      })
      if (result.fatal) this.error(result.errors.map((error) => error.message).join('\n'))
      return { code: result.code, map: result.map }
    },
  }
}
