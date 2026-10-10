import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { build, createServer, type Rolldown } from 'vite'
import { expect, test } from 'vitest'

import { shellChunkGroups } from './shell-chunk-groups'
import {
  PHONE_BOOT_SCREENS,
  SHELL_ENTRIES,
  shellChunksPlugin,
  shellManifest,
} from './shell-chunks-plugin'
import { bootAppearancePlugin } from './boot-appearance-plugin'

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
    phone: ['/platform/assets/shell.js', '/platform/assets/stack.js'],
    sessions: ['/platform/assets/sessions-screen.js', '/platform/assets/phone-shared.js'],
    session: ['/platform/assets/session-screen.js', '/platform/assets/phone-shared.js'],
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
    '/sessions-screen.tsx': { imports: ['/session-hook.ts'] },
    '/session-screen.tsx': { imports: ['/chat.tsx', '/menu.tsx'] },
    '/workbench.tsx': {
      imports: [
        '/session-hook.ts',
        '/chat.tsx',
        '/tree.tsx',
        '/button.tsx',
        '/editor.tsx',
        '/tabs.tsx',
        '/menu.tsx',
      ],
    },
    '/chat.tsx': { imports: [] },
    '/session-hook.ts': { imports: [] },
    '/tree.tsx': { imports: [] },
    '/dialog.tsx': { imports: ['/tabs.tsx', '/menu.tsx'] },
    '/menu.tsx': { imports: [] },
    '/tabs.tsx': { imports: [] },
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
    phoneScreens: ['/sessions-screen.tsx', '/session-screen.tsx'],
    phoneOverlays: ['/dialog.tsx'],
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
    '/chat.tsx': 'phone-session',
    '/tree.tsx': 'workbench',
    '/workbench.tsx': 'workbench',
  })
  expect(groupOf('/editor.tsx')).toBe('workbench-shared')
  // An overlay's workbench modules stay apart from workbench-shared; one a boot screen shares is initial.
  expect(groupOf('/tabs.tsx')).toBe('phone-overlays')
  expect(groupOf('/menu.tsx')).toBe('initial')
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

function htmlHookFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'fregat-html-hooks-'))
  const write = (name: string, source: string) => {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, source)
  }
  const entries = Object.values(SHELL_ENTRIES).concat(PHONE_BOOT_SCREENS)
  for (const [index, entry] of entries.entries()) write(entry, `export const value = ${index}`)
  write(
    'src/main.ts',
    `Promise.all([${entries.map((entry) => `import('./${entry.slice(4)}')`).join(',')}]).then(console.log)`,
  )
  write('src/dev-entry.ts', 'console.log("gallery")')
  write('boot.css', ':root { --boot-fixture: 1; }')
  write(
    'src/boot-appearance.ts',
    'document.documentElement.dataset.bootFixture = document.getElementById("bootstrap-fixture").textContent + ":" + Object.keys(JSON.parse(document.getElementById("shell-chunks")?.textContent ?? "{}" )).length;',
  )
  write(
    'index.html',
    '<html><head><script id="bootstrap-fixture" type="application/json">current</script></head><body><script type="module" src="/src/main.ts"></script></body></html>',
  )
  write(
    'dev.html',
    '<html><head><script id="bootstrap-fixture" type="application/json">current</script></head><body><script type="module" src="/src/dev-entry.ts"></script></body></html>',
  )
  return root
}

async function inspectStartupHtml(html: string, shellCount: number) {
  const browser = new Window()
  try {
    const document = new browser.DOMParser().parseFromString(html, 'text/html')
    const boot = document.getElementById('fregat-boot-script')
    expect(boot?.getAttribute('type')).toBeNull()
    expect(document.querySelectorAll('#fregat-boot-script')).toHaveLength(1)
    expect(html.indexOf('bootstrap-fixture')).toBeLessThan(html.indexOf('fregat-boot-script'))
    expect(html.indexOf('fregat-boot-style')).toBeLessThan(html.indexOf('fregat-boot-script'))
    if (shellCount > 0)
      expect(html.indexOf('shell-chunks')).toBeLessThan(html.indexOf('fregat-boot-script'))
    runInNewContext(boot?.textContent ?? '', { document })
    expect(document.documentElement.dataset.bootFixture).toBe(`current:${shellCount}`)
  } finally {
    await browser.happyDOM.close()
  }
}

test('structured Vite tags preserve startup data before the classic script in a production build', async () => {
  const root = htmlHookFixture()
  try {
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      base: '/demo/',
      plugins: [bootAppearancePlugin(root), shellChunksPlugin(root)],
      build: {
        write: false,
        rollupOptions: { input: [path.join(root, 'index.html'), path.join(root, 'dev.html')] },
      },
    })
    const result = Array.isArray(output) ? output[0] : output
    const documents =
      result && 'output' in result
        ? result.output
            .filter((item) => item.type === 'asset')
            .filter((item) => item.fileName.endsWith('.html'))
        : []
    expect(documents).toHaveLength(2)
    for (const asset of documents) {
      const html =
        typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
      await inspectStartupHtml(html, asset.fileName === 'index.html' ? 4 : 0)
      if (asset.fileName === 'index.html') expect(html).toContain('/demo/assets/')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)

test('structured Vite tags work without comment placeholders in development and gallery documents', async () => {
  const root = htmlHookFixture()
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [bootAppearancePlugin(root), shellChunksPlugin(root)],
    server: { middlewareMode: true, watch: null },
  })
  try {
    for (const name of ['index.html', 'dev.html']) {
      const html = await server.transformIndexHtml(
        `/${name}`,
        readFileSync(path.join(root, name), 'utf8'),
      )
      await inspectStartupHtml(html, 0)
    }
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
