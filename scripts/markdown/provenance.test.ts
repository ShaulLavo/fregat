import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

import { qualificationProvenance } from './provenance'

const execute = promisify(execFile)
const fixtureFiles = [
  'packages/markdown/src/candidate.ts',
  'packages/markdown/test/control.json',
  'apps/web/src/features/chat/components/control.tsx',
  'apps/web/src/features/chat/providers/control.tsx',
  'apps/web/src/features/chat/state/control.ts',
  'apps/web/src/features/chat/utils/control.ts',
  'apps/web/src/features/chat/tests/control.ts',
  'scripts/markdown/control.ts',
  'apps/web/test/providers.tsx',
  'apps/web/test/factories/markdown-browser.tsx',
  'apps/web/test/factories/markdown-observation.ts',
  'apps/web/test/factories/markdown-production-assets.ts',
  'apps/web/test/factories/markdown-production-types.ts',
  'apps/web/test/factories/markdown-production.tsx',
  'apps/web/test/factories/markdown-timeline-scene.tsx',
  'apps/web/test/factories/qualification-image-command.ts',
  'apps/web/test/markdown-production.html',
  'apps/web/test/markdown-production.ts',
  'apps/web/vitest.markdown-qualification.config.ts',
  'apps/web/vitest.browser.config.ts',
  'apps/web/vite.config.ts',
  'editor/packages/tree-sitter/src/treeSitter/markdown.ts',
  'editor/packages/tree-sitter/test/wasm-memory.browser.test.ts',
  'editor/packages/tree-sitter/test/wasm-memory.test.ts',
  'package.json',
  'bun.lock',
]

test('candidate source identity includes the production probe and its shared providers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-provenance-'))
  try {
    await writeFixture(root)
    const before = await qualificationProvenance(root)
    for (const file of fixtureFiles.filter((file) => file !== 'bun.lock'))
      expect(
        before.sources.some((entry) => entry.file === file),
        file,
      ).toBe(true)
    for (const file of [
      'editor/packages/tree-sitter/src/treeSitter/markdown.ts',
      'editor/packages/tree-sitter/test/wasm-memory.browser.test.ts',
      'editor/packages/tree-sitter/test/wasm-memory.test.ts',
      'apps/web/test/providers.tsx',
      'apps/web/src/features/chat/providers/control.tsx',
      'apps/web/src/features/chat/state/control.ts',
      'apps/web/test/factories/markdown-production-assets.ts',
    ]) {
      const current = await qualificationProvenance(root)
      await writeFile(path.join(root, file), 'changed provider\n')
      const after = await qualificationProvenance(root)
      expect(after.revision).toBe(before.revision)
      expect(after.sourceClosureSha256).not.toBe(current.sourceClosureSha256)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeFixture(root: string) {
  for (const file of fixtureFiles) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), `${file}\n`)
  }
  await execute('git', ['init', '--quiet'], { cwd: root })
  await execute('git', ['add', '.'], { cwd: root })
  const hooks = path.join(root, '.hooks')
  await mkdir(hooks)
  await execute(
    'git',
    [
      '-c',
      `core.hooksPath=${hooks}`,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'Owned fixture',
    ],
    { cwd: root },
  )
}
