import {
  packageJsonScripts,
  packageScriptRunner,
  projectScriptSuggestions,
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
    { command: 'bun run dev', name: 'Start the app', saved: true },
    { command: 'bun run test', name: 'test', saved: false },
  ])
})
