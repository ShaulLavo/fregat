import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { beginReloadBudget, prepareWithinReloadBudget } from '@/lib/reload-budget'
import { loadEditorThemeForSelection } from '@/features/editor/state/color-theme-store'
import { createBootstrap } from '@/state/bootstrap'
import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { terminalPanelQueryOptions } from '@/features/terminal/utils/panel-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { ApplicationBootstrap } from '@/components/application-bootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Production tree shaking can skip the editor barrels that import these styles.
import '@singapore-editor/core/style.css'
import '@singapore-editor/diff/style.css'
import '@singapore-editor/find/style.css'
import '@workspace/ui/globals.css'
import { App } from '@/App'
import { selectInitialAddress } from '@/features/address/state/storage'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { browserAddressHref } from '@/features/address/utils/browser-url'
import { createBrowserHistory } from '@tanstack/react-router'
import { createApplicationRouter } from '@/state/router'
import { createNavigation } from '@/state/navigation'
import { canPlaceEditorTab } from '@/features/workbench/state/group-geometry'
import { NavigationProvider } from '@/providers/navigation-provider'
import { LoggingErrorBoundary } from '@/components/logging-error-boundary.tsx'
import {} from '@/features/settings/providers/appearance-provider.tsx'
import { applyAppearance } from '@/features/settings/utils/apply-appearance.ts'
import {
  applyPaletteStylesheet,
  bootPaletteStylesheet,
} from '@/lib/appearance/utils/palette-style.ts'
import { initializeClientLogging, log } from '@/lib/client-logging.ts'
import { fontQueryOptions } from '@/lib/fonts/state/queries'
import { fontsInUse } from '@/lib/fonts/utils/stack'
import { isDesktop } from '@/lib/platform/bridge.ts'
import { applyBackdrop, resolveBackdrop } from '@/lib/platform/backdrop.ts'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace.ts'
import { reportReactError } from '@/lib/react-error-reporting.ts'
import { applicationHost } from '@/lib/application-host'

installEditorPerformanceTraceFromUrl()
initializeClientLogging()
applyBackdrop(applicationHost()?.backdrop ?? resolveBackdrop())
// Before `createRoot`, deliberately. The mirrored appearance is initial
// document state: descendants construct geometry and read computed styles on
// their first render. `AppearanceProvider` corrects it from the server snapshot
// in React's insertion phase before later layout effects run.
const boot = readSettingsMirror()
applyAppearance(boot, document.documentElement, systemColorMode() === 'dark')
applyPaletteStylesheet(document, bootPaletteStylesheet(boot['workbench.palette']))
const visualViewport = window.visualViewport
log.info({
  action: 'app.bootstrap',
  availHeight: window.screen.availHeight,
  availWidth: window.screen.availWidth,
  area: 'app',
  mode: import.meta.env.MODE,
  desktop: isDesktop(),
  devicePixelRatio: window.devicePixelRatio,
  innerHeight: window.innerHeight,
  screenWidth: window.screen.width,
  screenHeight: window.screen.height,
  innerWidth: window.innerWidth,
  visualViewportHeight: visualViewport?.height ?? null,
  visualViewportWidth: visualViewport?.width ?? null,
})
// index.html already started these faces from the boot mirror; the queries adopt them, and are
// the same ones AppearanceProvider asks for once settings confirm.
for (const font of fontsInUse(boot))
  void primaryQueryClient()
    .query(fontQueryOptions(font))
    .then(() => undefined)
    .catch(() => undefined)

// Preserve explicit fields before Router normalizes defaults; boot merges them with the cache.
const initialHref = applicationHost()?.initialAddress ?? selectInitialAddress(window.location.href)
const initialIntent = parseAddressIntent(initialHref)
const routerHistory = applicationHost()?.history ?? createBrowserHistory()
const initialBrowserHref = browserAddressHref(initialHref)
if (routerHistory.location.href !== initialBrowserHref) routerHistory.replace(initialBrowserHref)
routerHistory.flush()
const router = createApplicationRouter({ history: routerHistory, resources: resourceQueryClient })
const navigation = createNavigation(router, initialIntent, { canPlaceTab: canPlaceEditorTab })

beginReloadBudget()
const bootstrap = prepareWithinReloadBudget(() => createBootstrap(navigation))
const restoredWorkspace = bootstrap
  .getState()
  .application?.getSnapshot()
  .editor.workspaceStore.getState()
const warmViews: Promise<unknown>[] = []
if (restoredWorkspace?.selectedTabContent?.kind === 'settings')
  warmViews.push(
    resourceQueryClient
      .query(settingsPageQueryOptions)
      .then(() => undefined)
      .catch(() => undefined),
  )
if (
  restoredWorkspace?.workbenchPanels.bottomPanelOpen &&
  restoredWorkspace.workbenchPanels.activeBottomTab === 'terminal'
)
  warmViews.push(
    resourceQueryClient
      .query(terminalPanelQueryOptions)
      .then(() => undefined)
      .catch(() => undefined),
  )
if (restoredWorkspace)
  warmViews.push(
    loadEditorThemeForSelection(
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    ).catch(() => null),
  )
await Promise.all(warmViews)
if (import.meta.hot) import.meta.hot.dispose(() => bootstrap.dispose())

createRoot(document.getElementById('root')!, {
  onCaughtError: (error, errorInfo) => {
    reportReactError({ error, errorInfo, kind: 'caught' })
  },
  onRecoverableError: (error, errorInfo) => {
    reportReactError({ error, errorInfo, kind: 'recoverable' })
  },
  onUncaughtError: (error, errorInfo) => {
    reportReactError({ error, errorInfo, kind: 'uncaught' })
  },
}).render(
  <StrictMode>
    <LoggingErrorBoundary>
      <NavigationProvider navigation={navigation}>
        <ApplicationBootstrap bootstrap={bootstrap}>
          <App />
        </ApplicationBootstrap>
      </NavigationProvider>
    </LoggingErrorBoundary>
  </StrictMode>,
)

// After the first frame, so opening a terminal or settings never waits on the
// network. A failed prefetch is silent: the query retries when the pane opens.
const prefetchDeferredChunks = () => {
  void resourceQueryClient
    .query(terminalPanelQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
  void resourceQueryClient
    .query(settingsPageQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
}
if ('requestIdleCallback' in window) window.requestIdleCallback(prefetchDeferredChunks)
else setTimeout(prefetchDeferredChunks, 2000)
