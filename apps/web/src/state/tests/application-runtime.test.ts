import { workspacePreloadLanguages } from '@/features/editor/state/language-census'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import { EDITOR_SHIKI_PRELOAD_LANGUAGES } from '@/features/editor/utils/shiki-languages'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { activeServerOrigin, setActiveServerOrigin, setClient } from '@/lib/client'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { createApplicationRuntime } from '@/state/application-runtime'
import { createInProcessClient } from '../../../test/client'
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
      tabSize: 4,
    },
  })
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
