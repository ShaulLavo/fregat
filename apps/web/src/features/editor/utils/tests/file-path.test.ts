import { expect, test } from '../../../../../test/fixtures'
import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import {
  EDITOR_SHIKI_LANGUAGE_MAP,
  EDITOR_SHIKI_PRELOAD_LANGUAGES,
  resolveShikiLanguageRegistrations,
} from '@/features/editor/utils/shiki-languages'

test('keeps the tree-sitter-backed language ids stable', () => {
  expect(languageIdForFilePath('/repo/src/app.ts')).toBe('typescript')
  expect(languageIdForFilePath('/repo/src/app.tsx')).toBe('tsx')
  expect(languageIdForFilePath('/repo/src/app.js')).toBe('javascript')
  expect(languageIdForFilePath('/repo/src/app.jsx')).toBe('javascript')
  expect(languageIdForFilePath('/repo/src/app.css')).toBe('css')
  expect(languageIdForFilePath('/repo/src/app.html')).toBe('html')
  expect(languageIdForFilePath('/repo/package.json')).toBe('json')
  expect(languageIdForFilePath('/repo/README.md')).toBe('markdown')
})

test('maps common extensions to their shiki language ids', () => {
  expect(languageIdForFilePath('/repo/main.py')).toBe('python')
  expect(languageIdForFilePath('/repo/main.rs')).toBe('rust')
  expect(languageIdForFilePath('/repo/main.go')).toBe('go')
  expect(languageIdForFilePath('/repo/Main.java')).toBe('java')
  expect(languageIdForFilePath('/repo/main.kt')).toBe('kotlin')
  expect(languageIdForFilePath('/repo/main.scala')).toBe('scala')
  expect(languageIdForFilePath('/repo/main.c')).toBe('c')
  expect(languageIdForFilePath('/repo/main.cpp')).toBe('cpp')
  expect(languageIdForFilePath('/repo/main.h')).toBe('c')
  expect(languageIdForFilePath('/repo/main.hpp')).toBe('cpp')
  expect(languageIdForFilePath('/repo/main.cs')).toBe('csharp')
  expect(languageIdForFilePath('/repo/main.rb')).toBe('ruby')
  expect(languageIdForFilePath('/repo/index.php')).toBe('php')
  expect(languageIdForFilePath('/repo/main.swift')).toBe('swift')
  expect(languageIdForFilePath('/repo/app.yml')).toBe('yaml')
  expect(languageIdForFilePath('/repo/app.yaml')).toBe('yaml')
  expect(languageIdForFilePath('/repo/Cargo.toml')).toBe('toml')
  expect(languageIdForFilePath('/repo/index.xml')).toBe('xml')
  expect(languageIdForFilePath('/repo/query.sql')).toBe('sql')
  expect(languageIdForFilePath('/repo/run.sh')).toBe('shellscript')
  expect(languageIdForFilePath('/repo/run.bash')).toBe('shellscript')
  expect(languageIdForFilePath('/repo/run.zsh')).toBe('shellscript')
  expect(languageIdForFilePath('/repo/main.lua')).toBe('lua')
  expect(languageIdForFilePath('/repo/main.r')).toBe('r')
  expect(languageIdForFilePath('/repo/main.dart')).toBe('dart')
  expect(languageIdForFilePath('/repo/main.ex')).toBe('elixir')
  expect(languageIdForFilePath('/repo/main.exs')).toBe('elixir')
  expect(languageIdForFilePath('/repo/schema.graphql')).toBe('graphql')
  expect(languageIdForFilePath('/repo/App.vue')).toBe('vue')
  expect(languageIdForFilePath('/repo/App.svelte')).toBe('svelte')
  expect(languageIdForFilePath('/repo/change.diff')).toBe('diff')
  expect(languageIdForFilePath('/repo/change.patch')).toBe('diff')
  expect(languageIdForFilePath('/repo/app.ini')).toBe('ini')
  expect(languageIdForFilePath('/repo/deploy.ps1')).toBe('powershell')
  expect(languageIdForFilePath('/repo/main.tf')).toBe('terraform')
})

/**
 * The rows that unblock a language server, not just colour.
 *
 * A document with a null language id is never opened on its server at all —
 * document sync refuses it before `didOpen` — so every extension missing here
 * meant zls, nixd, hls, ocaml-lsp, tinymist, clojure-lsp, fsautocomplete and
 * texlab would spawn, initialize, and then sit idle forever. Each of these has a
 * server in the registry that claims the extension.
 */
test('gives every registry extension a language id, so its server is reachable', () => {
  expect(languageIdForFilePath('/repo/main.zig')).toBe('zig')
  expect(languageIdForFilePath('/repo/build.zon')).toBe('zig')
  expect(languageIdForFilePath('/repo/flake.nix')).toBe('nix')
  expect(languageIdForFilePath('/repo/Main.hs')).toBe('haskell')
  expect(languageIdForFilePath('/repo/Main.lhs')).toBe('haskell')
  expect(languageIdForFilePath('/repo/main.ml')).toBe('ocaml')
  expect(languageIdForFilePath('/repo/main.mli')).toBe('ocaml')
  expect(languageIdForFilePath('/repo/core.clj')).toBe('clojure')
  expect(languageIdForFilePath('/repo/core.cljs')).toBe('clojure')
  expect(languageIdForFilePath('/repo/core.cljc')).toBe('clojure')
  expect(languageIdForFilePath('/repo/deps.edn')).toBe('clojure')
  expect(languageIdForFilePath('/repo/main.typ')).toBe('typst')
  expect(languageIdForFilePath('/repo/main.typc')).toBe('typst')
  expect(languageIdForFilePath('/repo/Program.fs')).toBe('fsharp')
  expect(languageIdForFilePath('/repo/Program.fsi')).toBe('fsharp')
  expect(languageIdForFilePath('/repo/Program.fsx')).toBe('fsharp')
  expect(languageIdForFilePath('/repo/main.jl')).toBe('julia')
  expect(languageIdForFilePath('/repo/paper.tex')).toBe('latex')
  expect(languageIdForFilePath('/repo/refs.bib')).toBe('bibtex')
  expect(languageIdForFilePath('/repo/main.gleam')).toBe('gleam')
  expect(languageIdForFilePath('/repo/schema.prisma')).toBe('prisma')
  expect(languageIdForFilePath('/repo/Page.astro')).toBe('astro')
  expect(languageIdForFilePath('/repo/types.pyi')).toBe('python')
  expect(languageIdForFilePath('/repo/vars.tfvars')).toBe('terraform')
  expect(languageIdForFilePath('/repo/tasks.rake')).toBe('ruby')
  expect(languageIdForFilePath('/repo/gem.gemspec')).toBe('ruby')
  expect(languageIdForFilePath('/repo/config.ru')).toBe('ruby')
  expect(languageIdForFilePath('/repo/View.objc')).toBe('objective-c')
  expect(languageIdForFilePath('/repo/View.objcpp')).toBe('objective-cpp')
  expect(languageIdForFilePath('/repo/run.ksh')).toBe('shellscript')
  expect(languageIdForFilePath('/repo/app.dockerfile')).toBe('dockerfile')
})

test('covers the clangd extensions the table was missing', () => {
  expect(languageIdForFilePath('/repo/main.c++')).toBe('cpp')
  expect(languageIdForFilePath('/repo/main.hxx')).toBe('cpp')
  expect(languageIdForFilePath('/repo/main.h++')).toBe('cpp')
})

/**
 * Every value must be a language the shiki highlighter can actually build, or
 * the session is created, tree-sitter's own highlights are suppressed by it, and
 * the file renders as plain text after the worker rejects — which is strictly
 * worse than having no row at all.
 */
test('resolves every language id to a registered shiki grammar', () => {
  const paths = [
    '/repo/main.zig',
    '/repo/flake.nix',
    '/repo/Main.hs',
    '/repo/main.ml',
    '/repo/core.clj',
    '/repo/main.typ',
    '/repo/Program.fs',
    '/repo/main.jl',
    '/repo/paper.tex',
    '/repo/refs.bib',
    '/repo/main.gleam',
    '/repo/schema.prisma',
    '/repo/Page.astro',
    '/repo/View.objc',
    '/repo/View.objcpp',
  ]

  for (const path of paths) {
    const languageId = languageIdForFilePath(path)
    expect(languageId).not.toBeNull()
    expect(EDITOR_SHIKI_LANGUAGE_MAP).toHaveProperty(languageId!)
  }
})

test('preloads every language it can produce', () => {
  for (const languageId of Object.keys(EDITOR_SHIKI_LANGUAGE_MAP)) {
    expect(EDITOR_SHIKI_PRELOAD_LANGUAGES).toContain(languageId)
  }
})

test('resolves every preload id to a concrete grammar registration', async () => {
  const resolved = await Promise.all(
    EDITOR_SHIKI_PRELOAD_LANGUAGES.map(async (languageId) => ({
      languageId,
      registrations: await resolveShikiLanguageRegistrations(languageId),
    })),
  )

  for (const { languageId, registrations } of resolved) {
    expect(registrations.length, languageId).toBeGreaterThan(0)
    expect(
      registrations.some(
        (registration) =>
          registration.name === languageId || registration.aliases?.includes(languageId),
      ),
      languageId,
    ).toBe(true)
  }
})

test('maps extensionless dockerfile and makefile basenames', () => {
  expect(languageIdForFilePath('/repo/Dockerfile')).toBe('dockerfile')
  expect(languageIdForFilePath('/repo/Makefile')).toBe('makefile')
  expect(languageIdForFilePath('/repo/extra.mk')).toBe('makefile')
})

test('returns null for unknown ids so they never reach shiki', () => {
  expect(languageIdForFilePath('/repo/notes.txt')).toBeNull()
  expect(languageIdForFilePath('/repo/README')).toBeNull()
})

test('detects explicit ids, exact filenames, extensions and content hints in order', () => {
  expect(languageIdForFilePath('Cargo.lock')).toBe('toml')
  expect(languageIdForFilePath('other.lock')).toBe('json')
  expect(languageIdForFilePath('script.ts', { languageId: 'tsx', firstLine: '#!/bin/bash' })).toBe(
    'tsx',
  )
  expect(languageIdForFilePath('script.ts', { firstLine: '#!/bin/bash' })).toBe('typescript')
  expect(languageIdForFilePath('script', { firstLine: '#!/usr/bin/env -S python3 -u' })).toBe(
    'python',
  )
  expect(languageIdForFilePath('/folder.ts/unknown')).toBeNull()
  expect(languageIdForFilePath('types.d.ts')).toBe('typescript')
  expect(languageIdForFilePath('script', { firstLine: '#!/bin/bash' })).toBe('shellscript')
})
