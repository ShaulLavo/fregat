import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build, type HtmlTagDescriptor, type Plugin, type ResolvedConfig } from 'vite'
import { createScriptError } from '../../../scripts/structured-errors.ts'

type BootScript = { code: string; moduleIds: readonly string[] }

export function bootAppearancePlugin(webRoot: string): Plugin {
  const stylesheet = path.join(webRoot, 'boot.css')
  let config: ResolvedConfig
  let script: Promise<BootScript> | null = null
  const bootScript = () => (script ??= bundleBootScript(webRoot, config))

  return {
    name: 'fregat-boot-appearance',
    configResolved(resolved) {
      config = resolved
    },
    configureServer(server) {
      server.watcher.on('change', (file) => {
        void script?.then(({ moduleIds }) => {
          if (moduleIds.includes(file)) script = null
        })
      })
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(_html, context): Promise<HtmlTagDescriptor[]> {
        const { code, moduleIds } = await bootScript()
        context.server?.watcher.add([...moduleIds])
        const css = readFileSync(stylesheet, 'utf8')
        return [
          { tag: 'style', attrs: { id: 'fregat-boot-style' }, children: css, injectTo: 'head' },
          { tag: 'script', attrs: { id: 'fregat-boot-script' }, children: code, injectTo: 'head' },
        ]
      },
    },
  }
}

// A classic script, bundled from typed source: a module script would run after first paint.
async function bundleBootScript(webRoot: string, config: ResolvedConfig): Promise<BootScript> {
  const output = await build({
    configFile: false,
    root: webRoot,
    logLevel: 'warn',
    resolve: { alias: { '@': path.join(webRoot, 'src') } },
    define: {
      'import.meta.env.DEV': JSON.stringify(config.command === 'serve'),
      'import.meta.env.BASE_URL': JSON.stringify(config.base),
      'import.meta.env.VITE_SERVER_URL': JSON.stringify(config.env.VITE_SERVER_URL) ?? 'undefined',
    },
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: { entry: path.join(webRoot, 'src/boot-appearance.ts'), formats: ['iife'], name: 'boot' },
    },
  })
  const result = Array.isArray(output) ? output[0] : output
  const chunk = result && 'output' in result ? result.output[0] : undefined
  if (chunk?.type !== 'chunk')
    throw createScriptError('The appearance boot script could not be bundled.', {
      internal: { expected: 'chunk', observed: chunk?.type ?? 'missing' },
    })

  return { code: chunk.code, moduleIds: chunk.moduleIds }
}
