import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCorePackage } from '../../../examples/stress/core-package.mjs'
import { hashDirectory, rebuildPackage } from './editBatchesBuild.mjs'

const { values } = parseArgs({
  options: {
    'baseline-core-directory': { type: 'string' },
    'candidate-core-directory': { type: 'string', default: resolve(import.meta.dirname, '..') },
    output: { type: 'string' },
  },
})
assert.ok(values['baseline-core-directory'], 'Pass --baseline-core-directory')
assert.ok(values.output, 'Pass --output result.json')
const baseline = await rebuildPackage(values['baseline-core-directory'], '@singapore-editor/core')
const candidate = await rebuildPackage(values['candidate-core-directory'], '@singapore-editor/core')
assert.notEqual(baseline.sourceSha256, candidate.sourceSha256, 'Use distinct source revisions')
assert.notEqual(baseline.builtSha256, candidate.builtSha256, 'Use distinct output revisions')
const directory = await mkdtemp('/work/tmp/e032-build-proof-')
try {
  await cp(join(baseline.directory, 'src'), join(directory, 'src'), { recursive: true })
  await cp(join(baseline.directory, 'package.json'), join(directory, 'package.json'))
  await symlink(resolve(import.meta.dirname, '../node_modules'), join(directory, 'node_modules'))
  // Bundler comments embed package paths, so compare clean and repaired builds at the same path.
  const expectedBaseline = await rebuildPackage(directory, '@singapore-editor/core')
  await rm(join(directory, 'dist'), { recursive: true })
  await cp(join(candidate.directory, 'dist'), join(directory, 'dist'), { recursive: true })
  const stalePair = await loadCorePackage(directory)
  const before = {
    sourceSha256: await hashDirectory(stalePair.sourceDirectory),
    builtSha256: await hashDirectory(join(directory, 'dist')),
  }
  assert.equal(before.sourceSha256, baseline.sourceSha256)
  assert.equal(before.builtSha256, candidate.builtSha256)
  await writeFile(join(directory, 'dist', 'stale-output.txt'), 'output from the wrong revision')

  const rebuilt = await rebuildPackage(directory, '@singapore-editor/core')
  assert.equal(rebuilt.sourceSha256, baseline.sourceSha256)
  assert.equal(rebuilt.builtSha256, expectedBaseline.builtSha256)
  assert.notEqual(rebuilt.builtSha256, before.builtSha256)
  await assert.rejects(readFile(join(directory, 'dist', 'stale-output.txt')), { code: 'ENOENT' })
  await writeFile(
    resolve(values.output),
    JSON.stringify(
      {
        kind: 'source-build-correspondence-proof',
        capturedAt: new Date().toISOString(),
        baseline,
        candidate,
        expectedBaseline,
        mixedPair: before,
        rebuilt,
        sourceUnchanged: true,
        outputMatchesBaseline: true,
        staleOutputRemoved: true,
      },
      null,
      2,
    ) + '\n',
  )
  console.log('Mixed source/output was repaired to the exact clean baseline build at the same path')
} finally {
  await rm(directory, { recursive: true, force: true })
}
