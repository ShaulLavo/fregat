import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const source = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('the landing page offers the source build and no downloads or native apps', () => {
  const page = source('apps/site/src/pages/index.astro')
  expect(page).not.toMatch(/no releases|0\.0\.1|native app|download|windows|open cursor/i)
  expect(page).toContain('Run it from source')
  expect(page).toContain('Linux and macOS')
})

test('the README names the shipped desktop client and phone setup', () => {
  const readme = source('README.md')
  expect(readme).not.toContain('native mac')
  expect(readme).toMatch(/https proxy/i)
  expect(readme).toContain('pairing')
})

test.each([
  ['apps/mac/Sources/MacApp/main.swift', 'window.title = "Fregat"'],
  ['apps/desktop/native/macos/platform-webview.m', 'window.title = @"Fregat"'],
  ['apps/desktop/native/linux/platform-webview.c', 'GTK_WINDOW(window), "Fregat"'],
  ['apps/tui/README.md', '# Fregat TUI'],
  ['apps/tui/src/host/utils/arguments.ts', '`Fregat TUI'],
  ['apps/web/src/features/workbench/utils/titlebar-model.ts', "workspaceTitle: 'Fregat'"],
])('the product name in %s is Fregat', (file, expected) => {
  expect(source(file)).toContain(expected)
})
