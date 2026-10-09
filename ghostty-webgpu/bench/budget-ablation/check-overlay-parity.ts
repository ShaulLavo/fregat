import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { entryOverlay, runtimeOverlay } from './overlays.ts'

const [repository, bundle, wave] = process.argv.slice(2)
assert(repository && bundle && wave)
const previous = await import(join(bundle, 'tooling/overlays.ts'))
const source = await readFile(
  join(wave, 'lanes/r2-frame/shared-bundle-r07/entry-source.ts'),
  'utf8',
)
const oracle = await readFile(join(wave, 'lanes/r3-unicode/cell-oracle.ts'), 'utf8')
const manifest = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'))
const entry = entryOverlay(source, oracle)
assert.equal(entry, previous.entryOverlay(source, oracle))
assert.equal(createHash('sha256').update(entry).digest('hex'), manifest.entryOverlaySha256)
for (const path of [
  'src/render/frame-observer.ts',
  'src/dom/execution-local.ts',
  'src/render/webgl/text-pass.ts',
]) {
  const input: string = execFileSync(
    'git',
    ['show', `${manifest.runtimeCommit}:ghostty-webgpu/${path}`],
    {
      cwd: repository,
      encoding: 'utf8',
    },
  )
  assert.equal(runtimeOverlay('/' + path, input), previous.runtimeOverlay('/' + path, input))
}
console.log(
  JSON.stringify({
    entrySha256: manifest.entryOverlaySha256,
    runtimeOverlaysEqual: true,
    scope: 'Post-format research tooling reproduces the exact sealed diagnostic source transforms.',
  }),
)
