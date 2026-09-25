import {
  importableScripts,
  packageJsonScripts,
  packageScriptRunner,
  projectScriptSuggestions,
  t3ProjectScripts,
} from '@/features/chat-mode/utils/project-scripts'
import { expect, test } from '../../../../../test/fixtures'

test('reads a manifest into commands the detected runner can actually run', () => {
  const manifest = JSON.stringify({
    name: 'platform',
    scripts: { dev: 'vite', test: 'vitest run' },
  })

  expect(packageJsonScripts(manifest, packageScriptRunner(['bun.lock']))).toEqual([
    { command: 'bun run dev', name: 'dev' },
    { command: 'bun run test', name: 'test' },
  ])
  // `yarn <script>`, with no `run` — the one runner whose shape differs, and the
  // reason this is a lookup rather than a template.
  expect(packageJsonScripts(manifest, packageScriptRunner(['yarn.lock']))).toEqual([
    { command: 'yarn dev', name: 'dev' },
    { command: 'yarn test', name: 'test' },
  ])
})

test('offers nothing rather than throwing when the manifest is unusable', () => {
  const runner = packageScriptRunner([])

  // A project mid-edit has a broken manifest often. The palette opening on an
  // empty list is recoverable; the palette refusing to open is not.
  expect(packageJsonScripts('{ "scripts": ', runner)).toEqual([])
  expect(packageJsonScripts('{}', runner)).toEqual([])
  expect(packageJsonScripts(JSON.stringify({ scripts: [] }), runner)).toEqual([])
  expect(packageJsonScripts(JSON.stringify({ scripts: { build: 42, ok: 'tsc' } }), runner)).toEqual(
    [{ command: 'npm run ok', name: 'ok' }],
  )
})

test('puts saved scripts first and never lists the same command twice', () => {
  const suggestions = projectScriptSuggestions({
    discovered: [
      { command: 'bun run dev', name: 'dev' },
      { command: 'bun run test', name: 'test' },
    ],
    // Same command as `dev`, different label. Deduplicating by command is what
    // keeps the user's own name for it instead of the manifest key.
    saved: [{ command: 'bun run dev', name: 'Start the app' }],
  })

  expect(suggestions).toEqual([
    { command: 'bun run dev', name: 'Start the app', saved: true, origin: 'saved' },
    { command: 'bun run test', name: 'test', saved: false, origin: 'package.json' },
  ])
})

test('maps async false on a worktree script to waiting for setup, and skips malformed entries', () => {
  const file = JSON.stringify({
    scripts: [
      { name: 'Install', command: 'bun install', runOnWorktreeCreate: true, async: false },
      { name: 'Watch', command: 'bun run watch', runOnWorktreeCreate: true },
      { name: 'Lint', command: 'bun run lint', async: false },
      { name: '', command: 'nothing' },
      'not a script',
    ],
  })
  expect(t3ProjectScripts(file)).toEqual([
    { name: 'Install', command: 'bun install', runOnWorktreeCreate: true, waitForSetup: true },
    { name: 'Watch', command: 'bun run watch', runOnWorktreeCreate: true },
    { name: 'Lint', command: 'bun run lint' },
  ])
  expect(t3ProjectScripts('{')).toEqual([])
})

test('offers only scripts not saved by command or by name', () => {
  const file = [
    { name: 'Install', command: 'bun install' },
    { name: 'test', command: 'bun run test:all' },
    { name: 'Build', command: 'bun run build' },
  ]
  const saved = [
    { name: 'Setup', command: 'bun install' },
    { name: 'Test', command: 'bun test' },
  ]
  expect(importableScripts(file, saved)).toEqual([{ name: 'Build', command: 'bun run build' }])
})
