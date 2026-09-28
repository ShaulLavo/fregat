import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Against the editor's source, not its published build. Resolving @singapore-editor/core
// through its exports map picks up dist/, so a test here would pass or fail on
// whatever was last built rather than on what the editor currently does. The
// subpaths are derived from that same exports map so the two cannot drift.
const coreRoot = fileURLToPath(new URL('../editor', import.meta.url))
const coreExports = JSON.parse(readFileSync(`${coreRoot}/package.json`, 'utf8')).exports as Record<
  string,
  { readonly import?: string } | string
>
const coreSourceAliases = Object.entries(coreExports).flatMap(([subpath, target]) => {
  const dist = typeof target === 'string' ? target : target.import
  if (!dist?.endsWith('.js')) return []

  // Anchored, because a bare string find matches by prefix and the root entry
  // would then swallow every subpath.
  return [
    {
      find: new RegExp(`^@singapore-editor/core${subpath.slice(1).replaceAll('/', '\\/')}$`),
      replacement: `${coreRoot}/${dist.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')}`,
    },
  ]
})

export default defineConfig({
  resolve: {
    alias: coreSourceAliases,
    conditions: ['browser'],
  },
  test: {
    environment: 'happy-dom',
    // Keep solid-js/web on the same browser runtime and owner as solid-js.
    server: { deps: { inline: ['solid-js'] } },
  },
})
