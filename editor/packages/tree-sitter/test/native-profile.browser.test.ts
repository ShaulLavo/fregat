import { expect, it } from 'vitest'
import { createPieceTableSnapshot } from '@singapore-editor/core/document'
import { TYPESCRIPT_TREE_SITTER_LANGUAGE } from '../../tree-sitter-languages/src/index'
import { resolveTreeSitterLanguageContribution } from '../src/treeSitter/registry'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { createTreeSitterEditPayload } from '../src/session'
import { applyBatchToPieceTable } from '@singapore-editor/core/document'

const browserTest = it.skipIf(typeof Worker === 'undefined')

browserTest('profiles named worker phases across five independent runs', async () => {
  const samples = []
  for (let run = 0; run < 5; run += 1) {
    samples.push(...(await profileRun(run)))
  }
  console.info('NATIVE_PROFILE ' + JSON.stringify(samples))
  expect(samples).toHaveLength(100)
})

async function profileRun(run: number) {
  const backend = new TreeSitterWorkerClient()
  await backend.registerLanguages([
    await resolveTreeSitterLanguageContribution(TYPESCRIPT_TREE_SITTER_LANGUAGE),
  ])
  let snapshot = createPieceTableSnapshot(
    Array.from(
      { length: 850 },
      (_, index) =>
        `export const value${index} = (arg: number) => { if (arg > 2) return arg; return 0; };\n`,
    ).join(''),
  )
  const runtimeSessionId = `profile-${run}`
  const documentId = 'profile.ts'
  const languageId = 'typescript'
  const samples = []
  try {
    await backend.parse({
      documentId,
      runtimeSessionId,
      languageId,
      snapshotVersion: 1,
      snapshot,
      resultMode: 'parseOnly',
    })
    for (let edit = 0; edit < 20; edit += 1) {
      const edits = [{ from: 13, to: 18, text: edit % 2 ? 'value' : 'VALUE' }]
      const next = applyBatchToPieceTable(snapshot, edits)
      const payload = createTreeSitterEditPayload({
        documentId,
        runtimeSessionId,
        languageId,
        previousSnapshotVersion: edit + 1,
        snapshotVersion: edit + 2,
        previousSnapshot: snapshot,
        nextSnapshot: next,
        edits,
        resultMode: 'parseOnly',
      })!
      await backend.edit(payload)
      snapshot = next
      const result = await backend.queryRange({
        documentId,
        runtimeSessionId,
        languageId,
        snapshotVersion: edit + 2,
        includeHighlights: true,
        includeCaptures: false,
        range: { startIndex: 0, endIndex: Math.min(5000, snapshot.length) },
      })
      expect(result?.degraded ?? []).toEqual([])
      expect(result?.timings.some((timing) => timing.name === 'treeSitter.overlapResolution')).toBe(
        true,
      )
      samples.push({ run, edit, timings: result?.timings })
    }
  } finally {
    await backend.dispose()
  }
  return samples
}
