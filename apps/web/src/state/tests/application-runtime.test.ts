import { registerTestWorkspaceAddress } from '../../../test/factories/workspace-address'
import { ensureFolderPath } from '@/lib/file-server'
import { workspacePreloadLanguages } from '@/features/editor/state/language-census'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { activeServerOrigin, setActiveServerOrigin, setClient } from '@/lib/client'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { primaryQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { settingsSnapshot } from '../../../test/factories/settings'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { initialServerConnection } from '@workspace/client-core/environments/utils/connection'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { createApplicationRuntime } from '@/state/application-runtime'
import { createInProcessClient } from '../../../test/client'
import { vi } from 'vitest'
import { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { expect, test } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchFile } from '@/lib/file-server'
import type { EditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { retentionProvider } from '../../../test/factories/retention-provider'
import { createTestApplicationRuntime } from '../../../test/factories/application-runtime'

const originA = 'http://localhost:37121'
const originB = 'http://localhost:37122'
const root = filesystemPath('repo')

test('retained environment membership stays authoritative through suspension and terminal disposal', async ({
  server,
  client,
  onTestFinished,
}) => {
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  const second = await makeTestServer({ filesystemWatch: false })
  const originLeft = 'http://localhost:38131'
  const originRight = 'http://localhost:38132'
  const secondClient = createInProcessClient(second)
  setActiveServerOrigin(originLeft)
  setClient(client)
  setActiveServerOrigin(originRight)
  setClient(secondClient)
  useEnvironmentsStore.getState().activate(originLeft)
  await readEnvironmentDescriptor(originLeft, new AbortController().signal)
  await readEnvironmentDescriptor(originRight, new AbortController().signal)
  const application = createTestApplicationRuntime()
  const seen: EditorDocumentAnalysis[][] = []
  const disposed: EditorDocumentAnalysis[][] = []
  const stop = application.subscribeRetainedEditorAnalyses(() =>
    seen.push(Array.from(application.enumerateRetainedEditorAnalyses())),
  )
  onTestFinished(async () => {
    stop()
    application.dispose()
    queryClientFor(originLeft).clear()
    queryClientFor(originRight).clear()
    useEnvironmentsStore.setState(previousState, true)
    setActiveServerOrigin(previousOrigin)
    await second.cleanup()
  })
  const path = filesystemPath('retained.ts')
  await writeFile(join(server.root, path), 'const left = true\n')
  await writeFile(join(second.root, path), 'const right = true\n')
  const left = application
    .getSnapshot()
    .editor.documentStore.getState()
    .ensureLiveEditorDocument(await fetchFile(path, new AbortController().signal, client))
  const leftLease = left.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() =>
      disposed.push(Array.from(application.enumerateRetainedEditorAnalyses())),
    ),
  })!
  await leftLease.refresh(left.buffer.getTextSnapshot())
  application.activateEnvironment(originRight)
  const right = application
    .getSnapshot()
    .editor.documentStore.getState()
    .ensureLiveEditorDocument(await fetchFile(path, new AbortController().signal, secondClient))
  const rightLease = right.analysis.borrowStructural({
    languageId: 'typescript',
    provider: retentionProvider(() =>
      disposed.push(Array.from(application.enumerateRetainedEditorAnalyses())),
    ),
  })!
  await rightLease.refresh(right.buffer.getTextSnapshot())
  expect(Array.from(application.enumerateRetainedEditorAnalyses())).toEqual([
    left.analysis,
    right.analysis,
  ])
  application.activateEnvironment(originLeft)
  expect(Array.from(application.enumerateRetainedEditorAnalyses())).toEqual([
    left.analysis,
    right.analysis,
  ])
  application.dispose()
  expect(seen.at(-1)).toEqual([])
  expect(disposed).toEqual([[], []])
  expect(Array.from(application.enumerateRetainedEditorAnalyses())).toEqual([])
})

test('the active editor serves its census without a React tree, and a machine switch hands it over', async ({
  client,
}) => {
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  const second = await makeTestServer({ filesystemWatch: false })
  const secondClient = createInProcessClient(second)
  await ensureFolderPath(root, client)
  await ensureFolderPath(root, secondClient)
  const addresses = new Map([
    [originA, await registerTestWorkspaceAddress(client, root)],
    [originB, await registerTestWorkspaceAddress(secondClient, root)],
  ])
  setActiveServerOrigin(originA)
  setClient(client)
  setActiveServerOrigin(originB)
  setClient(secondClient)
  useEnvironmentsStore.getState().activate(originA)
  await readEnvironmentDescriptor(originA, new AbortController().signal)
  await readEnvironmentDescriptor(originB, new AbortController().signal)
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(confirmedEnvironmentId(originA))),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      analysisLimitMiCodeUnits: 10,
      tabSize: 4,
    },
  })
  application.start()
  const census = languageCensusQueryOptions(root).queryKey
  const openRepo = () =>
    application
      .getSnapshot()
      .editor.workspaceStore.getState()
      .switchWorkspace({
        workspaceAddress: addresses.get(application.getSnapshot().origin)!,
        birthtimeMs: 0,
        mtimeMs: 0,
        name: 'repo',
        path: root,
        size: 0,
        type: 'directory',
        version: '',
      })

  try {
    queryClientFor(originA).setQueryData(census, {
      readiness: 'ready',
      scanRoot: null,
      counts: { '.rs': 30 },
    })
    queryClientFor(originB).setQueryData(census, {
      readiness: 'ready',
      scanRoot: null,
      counts: { '.py': 30 },
    })
    openRepo()
    expect(workspacePreloadLanguages()).toEqual(['rust'])

    application.activateEnvironment(originB)
    openRepo()
    expect(workspacePreloadLanguages()).toEqual(['python'])

    application.activateEnvironment(originA)
    expect(workspacePreloadLanguages()).toEqual(['rust'])

    // Spelling reaches every retained editor, the parked one included.
    primaryQueryClient().setQueryData(
      settingsKeys.document(),
      settingsSnapshot({ values: { 'spellcheck.words': { fregat: true } } }),
    )
    for (const origin of [originA, originB]) {
      const environment = application.getEnvironment(confirmedEnvironmentId(origin))
      expect(environment?.editor.spellcheck.isAccepted('fregat')).toBe(true)
    }
    primaryQueryClient().removeQueries({ queryKey: settingsKeys.document() })
  } finally {
    application.dispose()
    expect(workspacePreloadLanguages()).toBeNull()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    useEnvironmentsStore.setState(previousState, true)
    setActiveServerOrigin(previousOrigin)
    await second.cleanup()
  }
})

test('a machine refused before its first handshake keeps its editor suspended until it is admitted', async ({
  client,
}) => {
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  const second = await makeTestServer({ filesystemWatch: false })
  const secondClient = createInProcessClient(second)
  await ensureFolderPath(root, client)
  await ensureFolderPath(root, secondClient)
  const addresses = new Map([
    [originA, await registerTestWorkspaceAddress(client, root)],
    [originB, await registerTestWorkspaceAddress(secondClient, root)],
  ])
  setActiveServerOrigin(originA)
  setClient(client)
  setActiveServerOrigin(originB)
  setClient(secondClient)
  useEnvironmentsStore.getState().activate(originA)
  await readEnvironmentDescriptor(originA, new AbortController().signal)
  await readEnvironmentDescriptor(originB, new AbortController().signal)
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(confirmedEnvironmentId(originA))),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      analysisLimitMiCodeUnits: 10,
      tabSize: 4,
    },
  })
  const census = languageCensusQueryOptions(root).queryKey
  const discovery = vi.spyOn(WorkspaceEditService.prototype, 'discoverRecovery')

  try {
    application.start()
    queryClientFor(originB).setQueryData(census, {
      readiness: 'ready',
      scanRoot: null,
      counts: { '.py': 30 },
    })
    const identityB = useEnvironmentsStore.getState().entries[originB]?.environmentId
    const refuse = () =>
      useEnvironmentsStore.setState((state) => ({
        connectionByOrigin: {
          ...state.connectionByOrigin,
          [originB]: {
            ...initialServerConnection,
            phase: 'identity-drift',
            expected: identityB ?? '',
            received: 'replacement',
          },
        },
      }))
    const openRepo = () =>
      application
        .getSnapshot()
        .editor.workspaceStore.getState()
        .switchWorkspace({
          workspaceAddress: addresses.get(application.getSnapshot().origin)!,
          birthtimeMs: 0,
          mtimeMs: 0,
          name: 'repo',
          path: root,
          size: 0,
          type: 'directory',
          version: '',
        })
    refuse()
    expect(() => application.activateEnvironment(originB)).toThrow(
      'is a different installation than before',
    )

    // Activated before its handshake, then refused by it: ConnectionGate withholds the workbench.
    useEnvironmentsStore.setState((state) => ({
      connectionByOrigin: { ...state.connectionByOrigin, [originB]: initialServerConnection },
    }))
    application.activateEnvironment(originB)
    refuse()
    discovery.mockClear()
    openRepo()
    expect(discovery).not.toHaveBeenCalled()
    expect(workspacePreloadLanguages()).toBeNull()

    useEnvironmentsStore.setState((state) => ({
      connectionByOrigin: {
        ...state.connectionByOrigin,
        [originB]: { ...initialServerConnection, phase: 'connected', generation: 1 },
      },
    }))
    expect(discovery).toHaveBeenCalled()
    expect(workspacePreloadLanguages()).toEqual(['python'])
  } finally {
    discovery.mockRestore()
    application.dispose()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    useEnvironmentsStore.setState(previousState, true)
    setActiveServerOrigin(previousOrigin)
    await second.cleanup()
  }
})
