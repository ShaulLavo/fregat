import { expect, test } from 'vitest'
import { attributeOwners, moduleOwner } from './bundle-owners'
import type { BundleStatsChunk } from './bundle-stats-plugin'

const repoRoot = '/work/projects/platform'

function chunk(
  fileName: string,
  gzipSize: number,
  modules: readonly (readonly [string, number])[],
): BundleStatsChunk {
  return {
    fileName,
    name: fileName,
    isEntry: false,
    isDynamicEntry: false,
    size: 0,
    gzipSize,
    imports: [],
    dynamicImports: [],
    modules: modules.map(([id, renderedLength]) => ({ id, renderedLength })),
  }
}

test('folds a module to the directory, package or checkout that owns it', () => {
  const owners = Object.fromEntries(
    [
      '/work/projects/platform/apps/web/src/features/chat/components/input.tsx',
      // Shares a prefix with `features/chat` and must not fold into it.
      '/work/projects/platform/apps/web/src/features/chat-mode/components/rail.tsx',
      '/work/projects/platform/apps/web/src/lib/focus/hooks/use-target.ts',
      '/work/projects/platform/apps/web/src/main.tsx',
      '/work/projects/platform/apps/web/index.html',
      '/work/projects/platform/packages/ui/src/components/button.tsx?v=1',
      '/work/projects/Editor/packages/core/dist/index.js',
      // A linked checkout's vendored dependency is a dependency, not the checkout.
      '/work/projects/ghostty-webgpu/node_modules/@tanstack/hotkeys/dist/index.js',
      '/work/projects/platform/node_modules/react-dom/index.js',
      '\0rolldown/runtime.js',
      '/opt/elsewhere/module.js',
    ].map((id) => [id, moduleOwner(id, repoRoot)]),
  )

  expect(Object.values(owners)).toEqual([
    'apps/web/src/features/chat',
    'apps/web/src/features/chat-mode',
    'apps/web/src/lib',
    'apps/web/src',
    'apps/web',
    'packages/ui',
    'Editor',
    'node_modules',
    'node_modules',
    'virtual',
    'external',
  ])
})

test('splits first-load bytes from lazy bytes per owner', () => {
  const rows = attributeOwners(
    [
      chunk('assets/index.js', 1000, [
        ['/work/projects/platform/apps/web/src/features/chat/a.tsx', 300],
        ['/work/projects/platform/apps/web/src/features/chat/b.tsx', 100],
        ['/work/projects/platform/node_modules/react/index.js', 600],
      ]),
      chunk('assets/panel.js', 500, [
        ['/work/projects/platform/apps/web/src/features/terminal/components/panel.tsx', 200],
        ['/work/projects/platform/apps/web/src/features/chat/c.tsx', 50],
      ]),
      chunk('assets/empty.js', 20, []),
    ],
    new Set(['assets/index.js']),
    repoRoot,
  )

  expect(rows).toEqual([
    {
      owner: 'node_modules',
      firstLoadRendered: 600,
      firstLoadGzip: 600,
      firstLoadModules: 1,
      lazyRendered: 0,
    },
    {
      owner: 'apps/web/src/features/chat',
      firstLoadRendered: 400,
      firstLoadGzip: 400,
      firstLoadModules: 2,
      lazyRendered: 50,
    },
    {
      owner: 'apps/web/src/features/terminal',
      firstLoadRendered: 0,
      firstLoadGzip: 0,
      firstLoadModules: 0,
      lazyRendered: 200,
    },
  ])
})

test('attributes resolved linked code consistently from a worktree', () => {
  const editorFile = '/work/projects/Editor/packages/core/dist/index.js'
  const linked = [{ owner: 'Editor', root: '/work/projects/Editor' }]
  expect(moduleOwner(editorFile, '/work/worktrees/platform/L4', linked)).toBe('Editor')
  expect(moduleOwner(editorFile, '/work/projects/platform', linked)).toBe('Editor')
  expect(
    moduleOwner('/work/projects/Editor-next/src/index.ts', '/work/worktrees/platform/L4', linked),
  ).toBe('external')
})
