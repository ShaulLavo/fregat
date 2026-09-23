import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build, type Plugin, type ResolvedConfig, type Rolldown } from 'vite'

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
      async handler(html, context) {
        const { code, moduleIds } = await bootScript()
        context.server?.watcher.add([...moduleIds])
        const css = readFileSync(stylesheet, 'utf8')
        return html.replace(
          '<!-- boot-appearance -->',
          () => `<style>\n${css}</style>\n    <script>\n${code}</script>`,
        )
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
  const [result] = [output].flat() as Rolldown.RolldownOutput[]
  const chunk = result?.output[0]
  if (chunk?.type !== 'chunk') throw new Error('boot-appearance: expected a script chunk')

  return { code: chunk.code, moduleIds: chunk.moduleIds }
}
