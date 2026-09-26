import path from 'node:path'
import type { Plugin, ResolvedConfig, Rolldown } from 'vite'

/**
 * Each lazy shell's root module, by the kind the boot script picks (src/lib/shell/utils/kind.ts).
 * The workbench ships in the entry script, so it has none.
 */
const SHELL_ENTRIES = {
  phone: 'src/features/phone/components/shell.tsx',
} as const

const PLACEHOLDER = '<!-- shell-chunks -->'

/**
 * Names every chunk each shell needs beyond the entry script, in a JSON script the pre-paint boot
 * script reads to `modulepreload` the chosen shell. Dev serves modules unbundled and gets none.
 */
export function shellChunksPlugin(webRoot: string): Plugin {
  let config: ResolvedConfig

  return {
    name: 'fregat-shell-chunks',
    configResolved(resolved) {
      config = resolved
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!html.includes(PLACEHOLDER)) return html
        const manifest =
          context.bundle && context.chunk
            ? shellManifest(webRoot, config.base, context.bundle, context.chunk)
            : {}
        const json = JSON.stringify(manifest).replaceAll('<', '\\u003c')
        return html.replace(
          PLACEHOLDER,
          () => `<script type="application/json" id="shell-chunks">${json}</script>`,
        )
      },
    },
  }
}

export function shellManifest(
  webRoot: string,
  base: string,
  bundle: Rolldown.OutputBundle,
  entry: Rolldown.OutputChunk,
) {
  const chunks = Object.values(bundle).filter(
    (item): item is Rolldown.OutputChunk => item.type === 'chunk',
  )
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const loaded = staticClosure(entry, byFile)
  const manifest: Record<string, string[]> = {}
  for (const [kind, relative] of Object.entries(SHELL_ENTRIES)) {
    const facade = path.join(webRoot, relative)
    const root = chunks.find((chunk) => chunk.facadeModuleId === facade)
    if (!root) throw new Error(`shell-chunks: no chunk for ${relative}; is it still lazy?`)
    manifest[kind] = [...staticClosure(root, byFile)]
      .filter((fileName) => !loaded.has(fileName))
      .map((fileName) => `${base}${fileName}`)
  }
  return manifest
}

function staticClosure(
  root: Rolldown.OutputChunk,
  byFile: ReadonlyMap<string, Rolldown.OutputChunk>,
) {
  const seen = new Set<string>()
  const pending = [root.fileName]
  for (let fileName = pending.pop(); fileName !== undefined; fileName = pending.pop()) {
    if (seen.has(fileName)) continue
    seen.add(fileName)
    pending.push(...(byFile.get(fileName)?.imports ?? []))
  }
  return seen
}
