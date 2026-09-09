import { ApplicationBootstrap } from '@/components/application-bootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Production tree shaking can skip the editor barrels that import these styles.
import '@singapor/core/style.css'
import '@singapor/diff/style.css'
import '@singapor/find/style.css'
import '@workspace/ui/globals.css'
import { App } from '@/App'
import { restoreAddressFromStorage } from '@/features/address/state/storage.ts'
import { LoggingErrorBoundary } from '@/components/logging-error-boundary.tsx'
import {
  bootAppearance,
  systemPrefersDark,
} from '@/features/settings/providers/appearance-provider.tsx'
import { applyAppearance } from '@/features/settings/utils/apply-appearance.ts'
import { initializeClientLogging, log } from '@/lib/client-logging.ts'
import { loadNerdFont } from '@/lib/default-nerd-font.ts'
import { isDesktop } from '@/lib/platform/bridge.ts'
import { applyBackdrop, resolveBackdrop } from '@/lib/platform/backdrop.ts'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace.ts'
import { reportReactError } from '@/lib/react-error-reporting.ts'

installEditorPerformanceTraceFromUrl()
initializeClientLogging()
applyBackdrop(resolveBackdrop())
// Before `createRoot`, deliberately. The mirrored appearance is initial
// document state: descendants construct geometry and read computed styles on
// their first render. `AppearanceProvider` corrects it from the server snapshot
// in React's insertion phase before later layout effects run.
const boot = bootAppearance()
applyAppearance(boot, document.documentElement, systemPrefersDark())
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

// Before `createRoot`, deliberately: `EditorStateProvider` seeds its stores from the
// address during its first render, so the stored address has to be in the URL by then.
// A desktop launch always arrives at `/`, which is exactly the case this covers.
restoreAddressFromStorage()

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
      <ApplicationBootstrap boot={boot}>
        <App />
      </ApplicationBootstrap>
    </LoggingErrorBoundary>
  </StrictMode>,
)
