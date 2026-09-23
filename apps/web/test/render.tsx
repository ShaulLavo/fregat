import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { StrictMode, useEffect, useState, type ReactElement, type ReactNode } from 'react'

import { EditorColorThemeProvider } from '@/features/editor/providers/color-theme-provider'
import { AppearanceProvider } from '@/features/settings/providers/appearance-provider'
import { FocusProvider } from '@/lib/focus/providers/provider'
import type { FocusService } from '@/lib/focus/state/service'
import { TestCommandProvider, type TestCommandRuntimeOptions } from './factories/command-runtime'
import { LanguageServerMatchProvider } from '@/features/editor/providers/language-server-match-provider'
import { activeServerOrigin, getClient } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { CommandBusProvider } from '@/keymap/providers/bus-provider'
import { createCommandRuntimeBinding } from '@/keymap/state/runtime-binding'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { ActiveEnvironmentApplication } from '@/components/active-environment-application'
import { ApplicationRuntimeProvider } from '@/providers/application-runtime-provider'
import { createApplicationRuntime, type ApplicationRuntime } from '@/state/application-runtime'
import { NavigationProvider } from '@/providers/navigation-provider'
import type { Navigation } from '@/state/navigation'
import { createTestNavigation } from './factories/navigation'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { testScopedStorage } from './factories/scoped-storage'
import type { EnvironmentConnections } from '@/state/environment-connections'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'

// Retry/gc off so failing queries surface immediately and no timers outlive a test.
export function createTestQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), getClient())
  return queryClient
}

export type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  application?: ApplicationRuntime
  navigation?: Navigation
  connections?: EnvironmentConnections
  settingsOwner?: QueryClient
  command?: TestCommandRuntimeOptions | false
  focusService?: FocusService
  queryClient?: QueryClient
  theme?: 'dark' | 'light'
}

export type RenderWithProvidersResult = RenderResult & { queryClient: QueryClient }

// Mirrors the app's top-level provider stack (main.tsx) so components render the
// way they do in production. Exported for the browser tests, which mount through
// `createRoot` rather than Testing Library and would otherwise grow a second,
// drifting copy of this stack.
export function AppProviders({
  application,
  navigation,
  connections,
  settingsOwner,
  children,
  command,
  focusService,
  queryClient,
}: {
  readonly application?: ApplicationRuntime
  readonly navigation?: Navigation
  readonly connections?: EnvironmentConnections
  readonly settingsOwner?: QueryClient
  readonly children: ReactNode
  readonly command?: TestCommandRuntimeOptions | false
  readonly focusService?: FocusService
  readonly queryClient: QueryClient
}) {
  const [binding] = useState(createCommandRuntimeBinding)
  const [runtime, setRuntime] = useState<{
    readonly application: ApplicationRuntime
    readonly navigation: Navigation
  } | null>(null)
  useEffect(() => {
    const navigationOwner =
      application ??
      createApplicationRuntime({
        workspaceCache: readWorkspaceCache(testScopedStorage),
        preparation: {
          appliedThemeContentHash: null,
          appliedThemeId: null,
          selectedThemeId: 'dark',
          syntaxHighlightingEnabled: false,
        },
      })
    const activeNavigation = navigation ?? createTestNavigation({ application: navigationOwner })
    const detach = activeNavigation.attach(navigationOwner)
    // Runtime subscriptions belong to this effect's lifetime, including StrictMode replay.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setRuntime({ application: navigationOwner, navigation: activeNavigation })
    return () => {
      detach()
      if (!navigation) activeNavigation.dispose()
      if (!application) navigationOwner.dispose()
    }
  }, [application, navigation])
  if (!runtime) return null
  const { application: navigationOwner, navigation: activeNavigation } = runtime
  const content = (
    <EnvironmentConnectionsContext value={connections ?? navigationOwner.connections}>
      <TooltipProvider delay={0}>{children}</TooltipProvider>
    </EnvironmentConnectionsContext>
  )

  return (
    <ApplicationRuntimeProvider application={navigationOwner}>
      <NavigationProvider navigation={activeNavigation}>
        <QueryClientProvider client={queryClient}>
          <SettingsOwnerProvider queryClient={settingsOwner ?? queryClient}>
            <LanguageServerMatchProvider>
              <FocusProvider service={focusService}>
                <AppearanceProvider>
                  <EditorColorThemeProvider>
                    {command === false ? (
                      <CommandBusProvider binding={binding}>{content}</CommandBusProvider>
                    ) : (
                      <TestCommandProvider options={command} queryClient={queryClient}>
                        {content}
                      </TestCommandProvider>
                    )}
                  </EditorColorThemeProvider>
                </AppearanceProvider>
              </FocusProvider>
            </LanguageServerMatchProvider>
          </SettingsOwnerProvider>
        </QueryClientProvider>
      </NavigationProvider>
    </ApplicationRuntimeProvider>
  )
}

// Theme is a setting now, so there is no prop to pass. Seeding the boot mirror
// is the honest equivalent: it is exactly what the app reads before the first
// snapshot lands. Call it before mounting.
export function seedBootMirrorTheme(theme: 'dark' | 'light') {
  localStorage.setItem(
    'platform.settings-boot-mirror.v1',
    JSON.stringify({ 'workbench.colorTheme': theme }),
  )
  seedPrefersColorScheme(theme)
}

// The boot mirror only rules until the real settings snapshot lands, and the
// shipped default for `workbench.colorTheme` is `system` - so the media query
// decides from then on. happy-dom reports light unless the device is told
// otherwise, which would flip the theme mid-test and re-run everything keyed on
// it. No-op in the browser project, where the Playwright context sets the scheme.
function seedPrefersColorScheme(theme: 'dark' | 'light') {
  const happyDom = (window as Window & { happyDOM?: HappyDomDeviceApi }).happyDOM
  if (!happyDom) return

  happyDom.settings.device.prefersColorScheme = theme
}

type HappyDomDeviceApi = { settings: { device: { prefersColorScheme: string } } }

// Returns the QueryClient for cache assertions.
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { queryClient, renderOptions } = providerRenderOptions(options)
  return { queryClient, ...render(ui, renderOptions) }
}

export function renderHookWithProviders<Result, Props>(
  callback: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> & RenderWithProvidersOptions = {},
) {
  const { queryClient, renderOptions } = providerRenderOptions(options)
  return { queryClient, ...renderHook(callback, renderOptions) }
}

function providerRenderOptions<Options extends RenderWithProvidersOptions>({
  application,
  navigation,
  connections,
  settingsOwner,
  command,
  focusService,
  queryClient = createTestQueryClient(),
  theme = 'dark',
  ...options
}: Options) {
  seedBootMirrorTheme(theme)
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders
        application={application}
        navigation={navigation}
        connections={connections}
        settingsOwner={settingsOwner}
        command={command}
        focusService={focusService}
        queryClient={queryClient}
      >
        {children}
      </AppProviders>
    )
  }
  return { queryClient, renderOptions: { wrapper: Wrapper, ...options } }
}

export function renderApplication(
  ui: ReactNode,
  application: ApplicationRuntime,
  { navigation = createTestNavigation({ application }) }: { readonly navigation?: Navigation } = {},
) {
  seedBootMirrorTheme('dark')
  const detach = navigation.attach(application)
  const rendered = render(
    <StrictMode>
      <NavigationProvider navigation={navigation}>
        <ApplicationRuntimeProvider application={application}>
          <EnvironmentConnectionsContext value={application.connections}>
            <FocusProvider>
              <HotkeysProvider>
                <CommandBusProvider binding={application.commandBinding}>
                  <ActiveEnvironmentApplication>{ui}</ActiveEnvironmentApplication>
                </CommandBusProvider>
              </HotkeysProvider>
            </FocusProvider>
          </EnvironmentConnectionsContext>
        </ApplicationRuntimeProvider>
      </NavigationProvider>
    </StrictMode>,
  )
  return {
    ...rendered,
    navigation,
    unmount() {
      rendered.unmount()
      detach()
      navigation.dispose()
    },
  }
}
