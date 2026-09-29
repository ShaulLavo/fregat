import { workspacePreloadLanguages } from '@/features/editor/state/language-census'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import { EDITOR_SHIKI_PRELOAD_LANGUAGES } from '@/features/editor/utils/shiki-languages'
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

const originA = 'http://localhost:37121'
const originB = 'http://localhost:37122'
const root = filesystemPath('repo')

test('the active editor serves its census without a React tree, and a machine switch hands it over', async ({
  client,
}) => {
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  const second = await makeTestServer({ filesystemWatch: false })
  setActiveServerOrigin(originA)
  setClient(client)
  setActiveServerOrigin(originB)
  setClient(createInProcessClient(second))
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
    application.getSnapshot().editor.workspaceStore.getState().switchWorkspace({
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
    expect(workspacePreloadLanguages()).toBe(EDITOR_SHIKI_PRELOAD_LANGUAGES)
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
  setActiveServerOrigin(originA)
  setClient(client)
  setActiveServerOrigin(originB)
  setClient(createInProcessClient(second))
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
      application.getSnapshot().editor.workspaceStore.getState().switchWorkspace({
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
    expect(workspacePreloadLanguages()).toBe(EDITOR_SHIKI_PRELOAD_LANGUAGES)

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
