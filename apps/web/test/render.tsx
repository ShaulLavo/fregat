import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { StrictMode, useState, type ReactElement, type ReactNode } from 'react'

import { EditorColorThemeProvider } from '@/features/editor/providers/color-theme-provider'
import { AppearanceProvider } from '@/features/settings/providers/appearance-provider'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
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
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { EnvironmentConnections } from '@/state/environment-connections'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { createTestEnvironmentConnections } from './factories/environment-connections'

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
  connections,
  settingsOwner,
  children,
  command,
  focusService,
  queryClient,
}: {
  readonly application?: ApplicationRuntime
  readonly connections?: EnvironmentConnections
  readonly settingsOwner?: QueryClient
  readonly children: ReactNode
  readonly command?: TestCommandRuntimeOptions | false
  readonly focusService?: FocusService
  readonly queryClient: QueryClient
}) {
  const [binding] = useState(createCommandRuntimeBinding)
  const [defaultConnections] = useState(
    () => connections ?? application?.connections ?? createTestEnvironmentConnections(),
  )
  const child = application ? (
    <ApplicationRuntimeProvider application={application}>{children}</ApplicationRuntimeProvider>
  ) : (
    children
  )
  const content = (
    <EnvironmentConnectionsContext value={connections ?? defaultConnections}>
      <TooltipProvider delay={0}>{child}</TooltipProvider>
    </EnvironmentConnectionsContext>
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsOwnerProvider queryClient={settingsOwner ?? queryClient}>
        <LanguageServerMatchProvider>
          <FocusProvider service={focusService}>
            <AppearanceProvider bootDensity={readSettingsMirror()['workbench.density']}>
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
  {
    application,
    connections,
    settingsOwner,
    command,
    focusService,
    queryClient = createTestQueryClient(),
    theme = 'dark',
    ...options
  }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  seedBootMirrorTheme(theme)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders
        application={application}
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

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) }
}

export function renderHookWithProviders<Result, Props>(
  callback: (props: Props) => Result,
  {
    application,
    connections,
    settingsOwner,
    command,
    focusService,
    queryClient = createTestQueryClient(),
    theme = 'dark',
    ...options
  }: Omit<RenderHookOptions<Props>, 'wrapper'> & RenderWithProvidersOptions = {},
) {
  seedBootMirrorTheme(theme)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders
        application={application}
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

  return { queryClient, ...renderHook(callback, { wrapper: Wrapper, ...options }) }
}

export function renderApplication(ui: ReactNode, application: ApplicationRuntime) {
  seedBootMirrorTheme('dark')
  return render(
    <StrictMode>
      <ApplicationRuntimeProvider application={application}>
        <EnvironmentConnectionsContext value={application.connections}>
          <FocusProvider>
            <HotkeysProvider>
              <CommandBusProvider binding={application.commandBinding}>
                <ActiveEnvironmentApplication bootDensity='cozy'>{ui}</ActiveEnvironmentApplication>
              </CommandBusProvider>
            </HotkeysProvider>
          </FocusProvider>
        </EnvironmentConnectionsContext>
      </ApplicationRuntimeProvider>
    </StrictMode>,
  )
}
