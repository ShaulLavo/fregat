import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/react-query'

import { createInactiveAnalysisRetention } from '@/features/editor/state/inactive-analysis-retention'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import {
  readLiveSettingsProjection,
  watchSettingValue,
} from '@/features/settings/state/live-projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { fetchFile } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { preparationDocuments } from '../../../../../test/factories/file-preparation'
import { retentionProvider } from '../../../../../test/factories/retention-provider'
import { settingsSnapshot } from '../../../../../test/factories/settings'
import { expect, test } from '../../../../../test/fixtures'

test('global retention settles membership, live settings and actual core lease release through mutations', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('retention.ts')
  await writeFile(join(server.root, path), 'const retained = true\n')
  const file = await fetchFile(path, new AbortController().signal, client)
  const owners = [preparationDocuments(), preparationDocuments()]
  const queries = new QueryClient()
  queries.setQueryData(settingsKeys.document(), settingsSnapshot())
  const enumerate = function* () {
    for (const owner of owners) yield* owner.enumerateEditorAnalyses()
  }
  const retention = createInactiveAnalysisRetention({
    enumerate,
    queryClient: queries,
    readLimit: () =>
      readLiveSettingsProjection(queries)!.values['editor.inactiveAnalysisEntryLimit'],
    subscribe: (listener) => {
      const stops = owners.map((owner) => owner.subscribeEditorAnalyses(listener))
      return () => {
        for (const stop of stops) stop()
      }
    },
    subscribeLimit: (listener) =>
      watchSettingValue(queries, 'editor.inactiveAnalysisEntryLimit', listener),
  })
  onTestFinished(() => {
    retention.dispose()
    for (const owner of owners) owner.dispose()
    queries.clear()
  })
  const provider = retentionProvider(() => undefined)
  const analyses = owners.map((owner) => owner.ensureLiveDocument(file).analysis)
  for (const analysis of analyses) {
    analysis
      .borrowStructural({ provider, languageId: 'typescript', configurationTag: ['first'] })
      ?.dispose()
    analysis
      .borrowStructural({ provider, languageId: 'typescript', configurationTag: ['second'] })
      ?.dispose()
  }
  const count = () => analyses.flatMap((analysis) => analysis.inspectRetention().entries).length
  expect(count()).toBe(4)
  await expect.poll(count).toBe(2)
  const mutations = queries
    .getMutationCache()
    .findAll({ mutationKey: editorMutationKeys.analysisRetention() })
  expect(mutations.some((mutation) => mutation.state.status === 'success')).toBe(true)
  const active = analyses[0]!.borrowStructural({
    provider,
    languageId: 'typescript',
    configurationTag: ['active'],
  })!
  queries.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ values: { 'editor.inactiveAnalysisEntryLimit': 0 } }),
  )
  await expect.poll(count).toBe(1)
  expect(analyses[0]!.inspectRetention().entries[0]?.leaseCount).toBe(1)
  active.dispose()
  expect(count()).toBe(1)
  await expect.poll(count).toBe(0)
})

test('membership replacement detaches the former analysis before its terminal disposal', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('replacement.ts')
  await writeFile(join(server.root, path), 'const first = true\n')
  const owner = preparationDocuments()
  const queries = new QueryClient()
  const retention = createInactiveAnalysisRetention({
    enumerate: () => owner.enumerateEditorAnalyses(),
    queryClient: queries,
    readLimit: () => 0,
    subscribe: (listener) => owner.subscribeEditorAnalyses(listener),
    subscribeLimit: () => () => undefined,
  })
  onTestFinished(() => {
    retention.dispose()
    owner.dispose()
    queries.clear()
  })
  const old = owner.ensureLiveDocument(await fetchFile(path, new AbortController().signal, client))
  const observed: unknown[] = []
  const lease = old.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() => observed.push(Array.from(owner.enumerateEditorAnalyses()))),
  })!
  await lease.refresh(old.buffer.getTextSnapshot())
  await writeFile(join(server.root, path), 'const next = true\n')
  owner.forceReplaceLiveDocument(await fetchFile(path, new AbortController().signal, client))
  const current = owner.getLiveDocument(old.key)!
  expect(observed).toEqual([[current.analysis]])
  const active = current.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() => observed.push(Array.from(owner.enumerateEditorAnalyses()))),
  })!
  await active.refresh(current.buffer.getTextSnapshot())
  owner.deleteLiveDocument(current.key)
  expect(observed.at(-1)).toEqual([])
  await expect
    .poll(() => queries.getMutationCache().getAll().at(-1)?.state)
    .toMatchObject({ status: 'success', data: { after: { analysisCount: 0 } } })
  expect(Array.from(owner.enumerateEditorAnalyses())).toEqual([])
})

test('disposal detaches membership and core notifications and abandons queued reconciliation', async ({
  server,
  client,
  onTestFinished,
}) => {
  const path = filesystemPath('disposed.ts')
  await writeFile(join(server.root, path), 'const disposed = true\n')
  const owner = preparationDocuments()
  const queries = new QueryClient()
  const document = owner.ensureLiveDocument(
    await fetchFile(path, new AbortController().signal, client),
  )
  const lease = document.analysis.borrowStructural({
    provider: retentionProvider(() => undefined),
    languageId: 'typescript',
  })!
  const retention = createInactiveAnalysisRetention({
    enumerate: () => owner.enumerateEditorAnalyses(),
    queryClient: queries,
    readLimit: () => 0,
    subscribe: (listener) => owner.subscribeEditorAnalyses(listener),
    subscribeLimit: () => () => undefined,
  })
  onTestFinished(() => {
    owner.dispose()
    queries.clear()
  })
  retention.dispose()
  lease.dispose()
  await Promise.resolve()
  expect(queries.getMutationCache().getAll()).toEqual([])
  expect(document.analysis.inspectRetention().entries).toHaveLength(1)
})
