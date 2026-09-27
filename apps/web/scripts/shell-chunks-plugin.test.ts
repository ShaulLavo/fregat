import type { Rolldown } from 'vite'
import { expect, test } from 'vitest'

import { staticGraphChunk } from './initial-chunk'
import { shellManifest } from './shell-chunks-plugin'

function chunk(fileName: string, imports: readonly string[], facadeModuleId: string | null) {
  return { type: 'chunk', fileName, imports, facadeModuleId } as unknown as Rolldown.OutputChunk
}

test('a shell preloads its chunk and the chunks it imports, minus what the entry already loads', () => {
  const entry = chunk('assets/initial.js', ['assets/react.js'], '/web/src/main.tsx')
  const bundle = {
    initial: entry,
    react: chunk('assets/react.js', [], null),
    shell: chunk(
      'assets/shell.js',
      ['assets/react.js', 'assets/stack.js'],
      '/web/src/features/phone/components/shell.tsx',
    ),
    stack: chunk('assets/stack.js', [], null),
    lazy: chunk('assets/file-screen.js', [], '/web/src/features/phone/components/file-screen.tsx'),
  } as unknown as Rolldown.OutputBundle

  expect(shellManifest('/web', '/platform/', bundle, entry)).toEqual({
    phone: ['/platform/assets/shell.js', '/platform/assets/stack.js'],
  })
})

test('the initial chunk takes the entry’s static imports and leaves its lazy ones', () => {
  const graph: Record<string, readonly string[]> = {
    '/main.tsx': ['/app.tsx'],
    '/app.tsx': ['/button.tsx'],
    '/button.tsx': [],
    '/dev-entry.tsx': ['/button.tsx', '/gallery.tsx'],
  }
  const name = staticGraphChunk('/main.tsx')
  const context = { getModuleInfo: (id: string) => ({ importedIds: graph[id] ?? [] }) }

  expect(['/main.tsx', '/app.tsx', '/button.tsx'].map((id) => name(id, context))).toEqual([
    'initial',
    'initial',
    'initial',
  ])
  expect(name('/gallery.tsx', context)).toBeNull()
})
