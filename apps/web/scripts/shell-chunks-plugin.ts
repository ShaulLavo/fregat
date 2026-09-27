import path from 'node:path'
import type { Plugin, ResolvedConfig, Rolldown } from 'vite'
import { createScriptError } from '../../../scripts/structured-errors'

/** Each lazy shell's root module, by the kind the boot script picks (src/lib/shell/utils/kind.ts). */
export const SHELL_ENTRIES = {
  phone: 'src/features/phone/components/shell.tsx',
  workbench: 'src/features/workspace/components/workbench-shell.tsx',
} as const

export const PHONE_BOOT_SCREENS = [
  'src/features/phone/components/sessions-screen.tsx',
  'src/features/phone/components/session-screen.tsx',
] as const

const PLACEHOLDER = '<!-- shell-chunks -->'

/**
 * Names every chunk and stylesheet each shell needs beyond the entry, in a JSON script the
 * pre-paint boot script reads to preload the chosen shell. Dev serves modules unbundled and gets none.
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
  const lazyRoots = dynamicRoots(entry, byFile)
  const manifest: Record<string, string[]> = {}
  const entriesByKind = {
    phone: [SHELL_ENTRIES.phone],
    workbench: [SHELL_ENTRIES.workbench],
    sessions: [PHONE_BOOT_SCREENS[0]],
    session: [PHONE_BOOT_SCREENS[1]],
  }
  for (const [kind, entries] of Object.entries(entriesByKind)) {
    const files = [
      ...new Set(
        entries.flatMap((relative) => {
          const facade = path.join(webRoot, relative)
          const root = chunks.find((chunk) => chunk.facadeModuleId === facade)
          if (!root) throw createScriptError(`shell-chunks: no chunk for ${relative}`)
          if (!lazyRoots.has(root.fileName))
            throw createScriptError(`shell-chunks: ${relative} must remain dynamically imported`)
          return [...staticClosure(root, byFile)].filter((fileName) => !loaded.has(fileName))
        }),
      ),
    ]
    // The shell's stylesheets too: the dynamic import waits for them, so they would otherwise
    // start only once the entry runs.
    const styles = files.flatMap((fileName) => [
      ...(byFile.get(fileName)?.viteMetadata?.importedCss ?? []),
    ])
    manifest[kind] = [...files, ...new Set(styles)].map((fileName) => `${base}${fileName}`)
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

function dynamicRoots(
  entry: Rolldown.OutputChunk,
  byFile: ReadonlyMap<string, Rolldown.OutputChunk>,
) {
  const pending = new Set([entry.fileName])
  const lazy = new Set<string>()
  for (const file of pending) {
    const chunk = byFile.get(file)
    if (!chunk) continue
    for (const target of chunk.dynamicImports) lazy.add(target)
    for (const target of [...chunk.imports, ...chunk.dynamicImports]) pending.add(target)
  }
  return lazy
}
