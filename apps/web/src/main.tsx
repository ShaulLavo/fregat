import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { beginReloadBudget, prepareWithinReloadBudget } from '@/lib/reload-budget'
import { loadEditorThemeForSelection } from '@/features/editor/state/color-theme-store'
import { createBootstrap } from '@/state/bootstrap'
import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { paletteContentQueryOptions } from '@/features/command-palette/utils/content-query'
import { filePickerDialogQueryOptions } from '@/features/file-picker/utils/dialog-query'
import { terminalPanelQueryOptions } from '@/features/terminal/utils/panel-query'
import { logsPanelQueryOptions } from '@/features/logs/utils/panel-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { ApplicationBootstrap } from '@/components/application-bootstrap'
import { StrictMode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { createBootError } from '@/lib/structured-errors'
import { reportClientError } from '@/lib/client-error-reporting'
import { createRoot } from 'react-dom/client'
import { createRenderer } from '@/state/renderer'

// Production tree shaking can skip the editor barrels that import these styles.
import '@singapore-editor/core/style.css'
import '@singapore-editor/diff/style.css'
import '@singapore-editor/find/style.css'
import '@workspace/ui/globals.css'
import { App } from '@/App'
import { selectInitialAddress } from '@/features/address/state/storage'
import { phoneStartAddress } from '@/features/address/utils/phone-start'
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
import { runtimeCapabilities } from '@/lib/platform/capabilities'
import { launchAddress } from '@/components/utils/launch-address'
import { applyBackdrop, resolveBackdrop } from '@/lib/platform/backdrop.ts'
import { editorPerformanceRecordingRequested } from '@/features/editor/state/performance-trace'
import { performanceRecordingMutationOptions } from '@/features/editor/utils/performance-recording-mutation'
import { runMutation } from '@/lib/mutations/run'
import { reportReactError } from '@/lib/react-error-reporting.ts'
import { configureIntentPrediction } from '@/lib/intent-prefetch-options'
import { takePairingCodeFromLocation } from '@/lib/pairing/state/link-claim'
import { useShellStore, watchShellKind } from '@/lib/shell/state/store'
import { COARSE_POINTER_QUERY } from '@/lib/shell/utils/kind'
import { shellQueryOptions } from '@/features/workspace/utils/shell-query'
import { warmDeferredOverlays } from '@/components/utils/overlay-modules'

configureIntentPrediction()
initializeClientLogging()
applyBackdrop(resolveBackdrop())
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
  ...runtimeCapabilities(),
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

// First: the code must leave the address bar before anything records the location.
const pairingCode = takePairingCodeFromLocation(
  new URL(import.meta.env.BASE_URL, location.href).href,
)
// Preserve explicit fields before Router normalizes defaults; boot merges them with the cache.
const restoredHref = selectInitialAddress(window.location.href)
const liveHref = selectInitialAddress(window.location.href, null)
const coarsePointer = window.matchMedia(COARSE_POINTER_QUERY).matches
const initialHref = phoneStartAddress(restoredHref, liveHref, coarsePointer)
const initialIntent = parseAddressIntent(initialHref)
const routerHistory = createBrowserHistory()
const initialBrowserHref = browserAddressHref(initialHref)
if (routerHistory.location.href !== initialBrowserHref) routerHistory.replace(initialBrowserHref)
routerHistory.flush()
const router = createApplicationRouter({ history: routerHistory, resources: resourceQueryClient })
const navigation = createNavigation(router, initialIntent, { canPlaceTab: canPlaceEditorTab })

beginReloadBudget()
const bootstrap = prepareWithinReloadBudget(() =>
  createBootstrap(navigation, {
    initialSession: coarsePointer && restoredHref !== liveHref ? 'list' : 'restore',
  }),
)
const restoredWorkspace = bootstrap
  .getState()
  .application?.getSnapshot()
  .editor.workspaceStore.getState()
const renderer = createRenderer()
function dispose() {
  renderer.dispose()
  bootstrap.dispose()
}
const hot = import.meta.hot
if (hot) {
  hot.on('vite:beforeFullReload', dispose)
  hot.dispose(() => {
    hot.off('vite:beforeFullReload', dispose)
    dispose()
  })
}
// Not a top-level await: the lazy chunks the boot waits on import this module's chunk, and would
// wait on its evaluation forever.
void start().catch((cause: unknown) => {
  const error = createBootError(cause)
  reportClientError({
    area: 'app',
    operation: 'app.startup_failed',
    message: error.message,
    cause: error,
  })
  renderer.render(
    () => createRoot(document.getElementById('root')!),
    <EmptyState
      className='h-dvh'
      tone='error'
      title={error.message}
      description={error.fix}
      action={<Button onClick={() => window.location.reload()}>Reload app</Button>}
    />,
  )
})

async function start() {
  if (editorPerformanceRecordingRequested())
    await runMutation(
      resourceQueryClient,
      performanceRecordingMutationOptions(resourceQueryClient),
      undefined,
    )
  // Paired before the bootstrap asks the machine anything, so its first request carries the cookie.
  // Loaded only for a pairing link; if it fails to load, the pairing screen still takes the code.
  if (pairingCode)
    await import('@/lib/pairing/state/claim-at-boot')
      .then(({ claimAtBoot }) => claimAtBoot(pairingCode))
      .catch(() => undefined)
  if (renderer.disposed) return
  // The boot script already preloads the chosen shell's chunks; this evaluates them before the first render.
  const kind = useShellStore.getState().kind
  const warmViews: Promise<unknown>[] = [
    resourceQueryClient
      .query(shellQueryOptions(kind))
      .then(() => undefined)
      .catch(() => undefined),
  ]
  watchShellKind()
  if (kind === 'workbench' && restoredWorkspace?.selectedTabContent?.kind === 'settings')
    warmViews.push(
      resourceQueryClient
        .query(settingsPageQueryOptions)
        .then(() => undefined)
        .catch(() => undefined),
    )
  if (
    kind === 'workbench' &&
    restoredWorkspace?.workbenchPanels.bottomPanelOpen &&
    restoredWorkspace.workbenchPanels.activeBottomTab === 'terminal'
  )
    warmViews.push(
      resourceQueryClient
        .query(terminalPanelQueryOptions)
        .then(() => undefined)
        .catch(() => undefined),
    )
  if (
    kind === 'workbench' &&
    (restoredWorkspace?.workbenchPanels.activeSidebarTab === 'logs' ||
      restoredWorkspace?.chatModePanels.activeToolTab === 'logs')
  )
    warmViews.push(
      resourceQueryClient
        .query(logsPanelQueryOptions)
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
  if (renderer.disposed) return

  renderer.render(
    () =>
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
      }),
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

  sampleStartupFrameCadence()

  window.launchQueue?.setConsumer(({ targetURL }) => {
    if (renderer.disposed) return
    window.focus()
    const href = launchAddress(targetURL, new URL(import.meta.env.BASE_URL, location.href).href)
    if (!href || href === `${location.pathname}${location.search}${location.hash}`) return
    router.history.push(href)
    router.history.flush()
  })

  if ('requestIdleCallback' in window) window.requestIdleCallback(prefetchDeferredChunks)
  else setTimeout(prefetchDeferredChunks, 2000)
}

// Warm closed views on idle. A failed prefetch is silent: the query retries when opened.
function prefetchDeferredChunks() {
  if (renderer.disposed) return
  // The phone warms these once its first screen is ready.
  if (useShellStore.getState().kind === 'phone') return
  warmDeferredOverlays()
  void resourceQueryClient
    .query(paletteContentQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
  void resourceQueryClient
    .query(filePickerDialogQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
  void resourceQueryClient
    .query(terminalPanelQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
  void resourceQueryClient
    .query(settingsPageQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
  void resourceQueryClient
    .query(logsPanelQueryOptions)
    .then(() => undefined)
    .catch(() => undefined)
}

// Renderer-frame sampling is bounded startup observability, with no transport or query state.
function sampleStartupFrameCadence() {
  const startedAt = performance.now()
  let frames = 0
  let frame: number | null = null
  const timeout = window.setTimeout(finish, 1_000)
  function finish() {
    if (frame === null) return
    window.cancelAnimationFrame(frame)
    frame = null
    window.clearTimeout(timeout)
    const durationMs = performance.now() - startedAt
    log.info({
      action: 'app.startup.frames',
      area: 'app',
      ...runtimeCapabilities(),
      frames,
      durationMs: Math.round(durationMs),
      rafPerSecond: Math.round((frames * 1_000) / durationMs),
      visibility: document.visibilityState,
    })
  }
  function tick() {
    frames += 1
    if (performance.now() - startedAt >= 1_000) {
      finish()
      return
    }
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
}
