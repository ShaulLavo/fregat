import { createTreeSource } from './factories/source'
import { readAll } from '../../editor/test/factories/snapshotText'
import { expect, it } from 'vitest'
import {
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
} from '@singapore-editor/core/document'
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
  const source = createTreeSource(
    backend.sourceEndpoint,
    readAll(createDocumentTextSnapshot(snapshot)),
  )
  try {
    const initial = await source.prepare()
    await backend.parse({
      documentId,
      runtimeSessionId,
      languageId,
      snapshotVersion: 1,
      source: initial.reference,
      resultMode: 'parseOnly',
    })
    await initial.dispose()
    for (let edit = 0; edit < 20; edit += 1) {
      const edits = [{ from: 13, to: 18, text: edit % 2 ? 'value' : 'VALUE' }]
      const previousRead = source.buffer.getTextSnapshot()
      source.edit(edits)
      const prepared = await source.prepare()
      const next = applyBatchToPieceTable(snapshot, edits)
      const payload = createTreeSitterEditPayload({
        documentId,
        runtimeSessionId,
        languageId,
        previousSnapshotVersion: edit + 1,
        snapshotVersion: edit + 2,
        previousRead,
        source: prepared.reference,
        edits,
        resultMode: 'parseOnly',
      })!
      await backend.edit(payload)
      await prepared.dispose()
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
    source.dispose()
    await backend.dispose()
  }
  return samples
}
