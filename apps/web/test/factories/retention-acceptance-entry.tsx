import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryHistory } from '@tanstack/react-router'
import { createApplicationRouter } from '@/state/router'
import { createNavigation } from '@/state/navigation'
import { createBootstrap } from '@/state/bootstrap'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { NavigationProvider } from '@/providers/navigation-provider'
import { ApplicationBootstrap } from '@/components/application-bootstrap'
import { App } from '@/App'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { beginReloadBudget, prepareWithinReloadBudget } from '@/lib/reload-budget'
import { applyAppearance } from '@/features/settings/utils/apply-appearance'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { applyPaletteStylesheet, bootPaletteStylesheet } from '@/lib/appearance/utils/palette-style'
import { loadEditorThemeForSelection } from '@/features/editor/state/color-theme-store'
import { canPlaceEditorTab } from '@/features/workbench/state/group-geometry'
import { captureRetentionAcceptanceEntry } from './retention-acceptance-entry-observation'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { mutationOptions } from '@tanstack/react-query'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { getClient } from '@/lib/client'
import { saveSettings } from '@/features/settings/utils/api'
import { SETTINGS_MUTATION_KEY } from '@/features/settings/utils/mutation-keys'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { runMutation } from '@/lib/mutations/run'

const addressKey = 'retention-acceptance-test-address'
const initial = localStorage.getItem(addressKey) ?? '/'
const history = createMemoryHistory({ initialEntries: [initial] })
const navigation = createNavigation(
  createApplicationRouter({ history, resources: resourceQueryClient }),
  parseAddressIntent(initial),
  { canPlaceTab: canPlaceEditorTab },
)
beginReloadBudget()
const bootstrap = prepareWithinReloadBudget(() => createBootstrap(navigation))
const boot = readSettingsMirror()
applyAppearance(boot, document.documentElement, systemColorMode() === 'dark')
applyPaletteStylesheet(document, bootPaletteStylesheet(boot['workbench.palette']))
void loadEditorThemeForSelection(
  document.documentElement.classList.contains('dark') ? 'dark' : 'light',
)
const stopHistory = history.subscribe(() => localStorage.setItem(addressKey, history.location.href))
window.addEventListener(
  'pagehide',
  () => {
    history.flush()
    localStorage.setItem(addressKey, history.location.href)
    stopHistory()
  },
  { once: true },
)
Object.defineProperty(window, '__retentionAcceptanceBootstrap', {
  configurable: true,
  value: () => {
    const state = bootstrap.getState()
    return {
      error: state.error,
      unpaired: state.unpaired,
      mounted: Boolean(state.application),
      origin: state.application?.getSnapshot().origin ?? null,
    }
  },
})
const element = document.getElementById('root')
if (element)
  createRoot(element).render(
    <NavigationProvider navigation={navigation}>
      <ApplicationBootstrap bootstrap={bootstrap}>
        <App />
        <RetentionAcceptanceEntryObserver />
      </ApplicationBootstrap>
    </NavigationProvider>,
  )

function RetentionAcceptanceEntryObserver() {
  const application = useApplicationRuntime()
  const commands = useEditorCommands()
  const documents = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceStoreApi()
  const ui = useEditorUiStoreApi()
  const theme = useEditorColorTheme()
  const settingsOwner = useSettingsOwner()
  useLayoutEffect(() => {
    const observation = {
      application,
      navigation,
      commands,
      documents,
      workspace,
      ui,
      theme,
      capture: captureRetentionAcceptanceEntry,
      openFixture: async () => {
        await application.openEnvironmentWorkspaceRoot(
          activeEnvironmentId(),
          filesystemPath('repo'),
        )
        return navigation
          .editorCommands(application.getSnapshot().editor.workspaceStore)
          .openFileSurface(filesystemPath('repo/src/editor-tab-a.ts'))
      },
      setSyntaxEnabled: (enabled: boolean) =>
        runMutation(
          settingsOwner,
          mutationOptions({
            mutationKey: SETTINGS_MUTATION_KEY,
            scope: { id: 'retention-acceptance-setting' },
            mutationFn: () =>
              saveSettings(
                {
                  mutationId: crypto.randomUUID(),
                  target: 'user',
                  operations: [
                    { kind: 'set', key: 'editor.syntaxHighlighting.enabled', value: enabled },
                    { kind: 'set', key: 'editor.codeTheme.dark', value: 'dark-plus' },
                  ],
                },
                getClient(),
              ),
            onSuccess: () => settingsOwner.invalidateQueries({ queryKey: settingsKeys.all }),
          }),
          undefined,
        ),
    }
    Object.defineProperty(window, '__retentionAcceptanceEntry', {
      configurable: true,
      value: observation,
    })
    return () => {
      delete window.__retentionAcceptanceEntry
    }
  }, [application, commands, documents, workspace, ui, theme, settingsOwner])
  return null
}

declare global {
  interface Window {
    __retentionAcceptanceBootstrap?: () => {
      readonly error: string | null
      readonly unpaired: boolean
      readonly mounted: boolean
      readonly origin: string | null
    }
    __retentionAcceptanceEntry?: {
      readonly application: ReturnType<typeof useApplicationRuntime>
      readonly navigation: typeof navigation
      readonly commands: ReturnType<typeof useEditorCommands>
      readonly documents: ReturnType<typeof useEditorDocumentStoreApi>
      readonly workspace: ReturnType<typeof useEditorWorkspaceStoreApi>
      readonly ui: ReturnType<typeof useEditorUiStoreApi>
      readonly theme: ReturnType<typeof useEditorColorTheme>
      readonly capture: typeof captureRetentionAcceptanceEntry
      readonly openFixture: () => Promise<
        Awaited<ReturnType<ReturnType<typeof useEditorCommands>['openFileSurface']>>
      >
      readonly setSyntaxEnabled: (
        enabled: boolean,
      ) => Promise<Awaited<ReturnType<typeof saveSettings>>>
    }
  }
}
