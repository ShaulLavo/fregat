import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
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
import { canPlaceEditorTab } from '@/lib/documents/state/group-geometry'
import { NavigationProvider } from '@/providers/navigation-provider'
import { LoggingErrorBoundary } from '@/components/logging-error-boundary.tsx'
import {} from '@/features/settings/providers/appearance-provider.tsx'
import { applyAppearance } from '@/features/settings/utils/apply-appearance.ts'
import {
  applyPaletteStylesheet,
  bootPaletteStylesheet,
} from '@/lib/appearance/utils/palette-style.ts'
import { initializeClientLogging, log } from '@/lib/client-logging.ts'
import { loadNerdFont } from '@/lib/default-nerd-font.ts'
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
// The mirrored family, not the shipped default: `loadNerdFont` writes
// `--font-mono` both before and after its fetch, so loading JetBrainsMono here
// would overwrite the family `applyAppearance` just set — once immediately, and
// again whenever the download resolved, which could land after
// `AppearanceProvider` had already corrected it.
void loadNerdFont(boot['editor.fontFamily'])

// Preserve explicit fields before Router normalizes defaults; boot merges them with the cache.
const initialHref = applicationHost()?.initialAddress ?? selectInitialAddress(window.location.href)
const initialIntent = parseAddressIntent(initialHref)
const routerHistory = applicationHost()?.history ?? createBrowserHistory()
const initialBrowserHref = browserAddressHref(initialHref)
if (routerHistory.location.href !== initialBrowserHref) routerHistory.replace(initialBrowserHref)
routerHistory.flush()
const router = createApplicationRouter({ history: routerHistory })
const navigation = createNavigation(router, initialIntent, { canPlaceTab: canPlaceEditorTab })

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
        <ApplicationBootstrap boot={boot}>
          <App />
        </ApplicationBootstrap>
      </NavigationProvider>
    </LoggingErrorBoundary>
  </StrictMode>,
)
