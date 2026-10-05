import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryHistory } from '@tanstack/react-router'
import { expect, onTestFinished } from 'vitest'
import { App } from '@/App'
import { ApplicationBootstrap } from '@/components/application-bootstrap'
import { NavigationProvider } from '@/providers/navigation-provider'
import { createApplicationRouter } from '@/state/router'
import { createNavigation } from '@/state/navigation'
import { createBootstrap } from '@/state/bootstrap'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { canPlaceEditorTab } from '@/features/workbench/state/group-geometry'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createClientInvariantError } from '@/lib/structured-errors'
import { disposeEditorSyntaxHighlighting } from '@/features/editor/state/syntax-highlighting'

export async function mountRetentionLayoutApp() {
  const referenceIds = new WeakMap<object, number>()
  let nextReferenceId = 1
  const identifyReference = (value: object | null | undefined) => {
    if (!value) return null
    const existing = referenceIds.get(value)
    if (existing) return existing
    const id = nextReferenceId++
    referenceIds.set(value, id)
    return id
  }
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const navigation = createNavigation(
    createApplicationRouter({ history, resources: resourceQueryClient }),
    parseAddressIntent('/'),
    { canPlaceTab: canPlaceEditorTab },
  )
  const bootstrap = createBootstrap(navigation)
  const container = document.createElement('main')
  container.style.width = '1400px'
  document.body.append(container)
  const root = createRoot(container)
  let owner: LayoutOwner | null = null
  const capture = (value: LayoutOwner | null) => {
    owner = value
  }
  root.render(
    <NavigationProvider navigation={navigation}>
      <ApplicationBootstrap bootstrap={bootstrap}>
        <App />
        <LayoutOwnerObserver capture={capture} />
      </ApplicationBootstrap>
    </NavigationProvider>,
  )
  onTestFinished(async () => {
    root.unmount()
    bootstrap.dispose()
    navigation.dispose()
    container.remove()
    await disposeEditorSyntaxHighlighting()
    localStorage.clear()
  })
  await expect.poll(() => owner, { timeout: 15_000 }).not.toBeNull()
  const read = () => {
    if (!owner) throw createClientInvariantError('Layout application owners are unavailable')
    return owner
  }
  const application = read().application
  expect(
    await application.openEnvironmentWorkspaceRoot(activeEnvironmentId(), filesystemPath('repo')),
  ).toMatch(/opened|already-open/)
  return {
    identifyReference,
    container,
    read,
    application,
    navigation,
    get queryClient() {
      return application.getSnapshot().queryClient
    },
    rootPath: filesystemPath('repo'),
  }
}

type LayoutOwner = {
  readonly application: ReturnType<typeof useApplicationRuntime>
  readonly commands: ReturnType<typeof useEditorCommands>
  readonly documents: ReturnType<typeof useEditorDocumentStoreApi>
  readonly workspace: ReturnType<typeof useEditorWorkspaceStoreApi>
  readonly ui: ReturnType<typeof useEditorUiStoreApi>
  readonly theme: ReturnType<typeof useEditorColorTheme>
}

function LayoutOwnerObserver({
  capture,
}: {
  readonly capture: (owner: LayoutOwner | null) => void
}) {
  const application = useApplicationRuntime()
  const commands = useEditorCommands()
  const documents = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceStoreApi()
  const ui = useEditorUiStoreApi()
  const theme = useEditorColorTheme()
  useLayoutEffect(() => {
    capture({ application, commands, documents, workspace, ui, theme })
    return () => capture(null)
  }, [application, commands, documents, workspace, ui, theme, capture])
  return null
}

export type RetentionLayoutApp = Awaited<ReturnType<typeof mountRetentionLayoutApp>>
