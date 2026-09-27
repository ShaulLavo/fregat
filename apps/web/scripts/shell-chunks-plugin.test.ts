import type { Rolldown } from 'vite'
import { expect, test } from 'vitest'

import { shellChunkGroups } from './shell-chunk-groups'
import { shellManifest } from './shell-chunks-plugin'

function chunk(
  fileName: string,
  imports: readonly string[],
  facadeModuleId: string | null,
  importedCss: readonly string[] = [],
  dynamicImports: readonly string[] = [],
) {
  return {
    type: 'chunk',
    fileName,
    imports,
    dynamicImports,
    facadeModuleId,
    viteMetadata: { importedCss: new Set(importedCss), importedAssets: new Set() },
  } as unknown as Rolldown.OutputChunk
}

test('a shell preloads its chunks and stylesheets, minus what the entry already loads', () => {
  const entry = chunk(
    'assets/initial.js',
    ['assets/react.js'],
    '/web/src/main.tsx',
    ['assets/initial.css'],
    [
      'assets/shell.js',
      'assets/workbench-shell.js',
      'assets/sessions-screen.js',
      'assets/session-screen.js',
    ],
  )
  const bundle = {
    initial: entry,
    react: chunk('assets/react.js', [], null),
    shell: chunk(
      'assets/shell.js',
      ['assets/react.js', 'assets/stack.js'],
      '/web/src/features/phone/components/shell.tsx',
    ),
    stack: chunk('assets/stack.js', [], null),
    sessions: chunk(
      'assets/sessions-screen.js',
      ['assets/phone-shared.js'],
      '/web/src/features/phone/components/sessions-screen.tsx',
    ),
    session: chunk(
      'assets/session-screen.js',
      ['assets/phone-shared.js'],
      '/web/src/features/phone/components/session-screen.tsx',
    ),
    shared: chunk('assets/phone-shared.js', [], null),
    lazy: chunk('assets/file-screen.js', [], '/web/src/features/phone/components/file-screen.tsx'),
    workbenchShell: chunk(
      'assets/workbench-shell.js',
      ['assets/workbench.js'],
      '/web/src/features/workspace/components/workbench-shell.tsx',
    ),
    workbench: chunk('assets/workbench.js', ['assets/react.js'], null, ['assets/workbench.css']),
  } as unknown as Rolldown.OutputBundle

  expect(shellManifest('/web', '/platform/', bundle, entry)).toEqual({
    phone: [
      '/platform/assets/shell.js',
      '/platform/assets/stack.js',
      '/platform/assets/sessions-screen.js',
      '/platform/assets/phone-shared.js',
      '/platform/assets/session-screen.js',
    ],
    workbench: [
      '/platform/assets/workbench-shell.js',
      '/platform/assets/workbench.js',
      '/platform/assets/workbench.css',
    ],
  })
})

test('each shell’s first load gets a group, and the phone never shares the workbench’s own', () => {
  const graph: Record<string, { imports: readonly string[]; lazy?: readonly string[] }> = {
    '/main.tsx': { imports: ['/app.tsx'] },
    '/app.tsx': { imports: ['/button.tsx'], lazy: ['/phone.tsx', '/workbench.tsx'] },
    '/button.tsx': { imports: [] },
    '/phone.tsx': {
      imports: ['/session-hook.ts'],
      lazy: ['/session-screen.tsx', '/file-screen.tsx'],
    },
    '/file-screen.tsx': { imports: ['/editor.tsx'] },
    '/editor.tsx': { imports: [] },
    '/session-screen.tsx': { imports: ['/chat.tsx'] },
    '/workbench.tsx': {
      imports: ['/session-hook.ts', '/chat.tsx', '/tree.tsx', '/button.tsx', '/editor.tsx'],
    },
    '/chat.tsx': { imports: [] },
    '/session-hook.ts': { imports: [] },
    '/tree.tsx': { imports: [] },
    '/dev-entry.tsx': { imports: ['/button.tsx', '/gallery.tsx'] },
  }
  const context = {
    getModuleInfo: (id: string) => ({
      importedIds: graph[id]?.imports ?? [],
      dynamicallyImportedIds: graph[id]?.lazy ?? [],
    }),
  }
  const groups = shellChunkGroups('/main.tsx', {
    phone: '/phone.tsx',
    workbench: '/workbench.tsx',
    phoneScreens: ['/session-screen.tsx'],
  })
  const groupOf = (id: string) =>
    groups.map((group) => group.name(id, context)).find((name) => name !== null) ?? null

  expect(
    Object.fromEntries(
      [
        '/main.tsx',
        '/button.tsx',
        '/session-hook.ts',
        '/chat.tsx',
        '/tree.tsx',
        '/workbench.tsx',
      ].map((id) => [id, groupOf(id)]),
    ),
  ).toEqual({
    '/main.tsx': 'initial',
    '/button.tsx': 'initial',
    '/session-hook.ts': 'initial',
    '/chat.tsx': 'initial',
    '/tree.tsx': 'workbench',
    '/workbench.tsx': 'workbench',
  })
  expect(groupOf('/editor.tsx')).toBe('workbench-shared')
  expect(groupOf('/gallery.tsx')).toBeNull()
  expect(groupOf('/session-screen.tsx')).toBeNull()
})

test('a facade imported only statically cannot masquerade as a lazy shell', () => {
  const entry = chunk('assets/initial.js', ['assets/shell.js'], '/web/src/main.tsx')
  const shell = chunk('assets/shell.js', [], '/web/src/features/phone/components/shell.tsx')
  expect(() => shellManifest('/web', '/', { entry, shell }, entry)).toThrow(
    'must remain dynamically imported',
  )
})
