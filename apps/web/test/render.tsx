import { AppProviders, createTestQueryClient, seedHtmlTheme } from './providers'
import type { TestCommandRuntimeOptions } from './factories/command-runtime'
import { paletteContentQueryOptions } from '@/features/command-palette/utils/content-query'
import { filePickerDialogQueryOptions } from '@/features/file-picker/utils/dialog-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { StrictMode, type ReactElement, type ReactNode } from 'react'

import { FocusProvider } from '@/lib/focus/providers/provider'
import type { FocusService } from '@/lib/focus/state/service'
import { CommandBusProvider } from '@/keymap/providers/bus-provider'
import { ActiveEnvironmentApplication } from '@/components/active-environment-application'
import { ApplicationRuntimeProvider } from '@/providers/application-runtime-provider'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { NavigationProvider } from '@/providers/navigation-provider'
import { bindNavigation } from '@/state/navigation-binding'
import type { Navigation } from '@/state/navigation'
import { createTestNavigation } from './factories/navigation'
import type { EnvironmentConnections } from '@/state/environment-connections'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'

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

// Returns the QueryClient for cache assertions.
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { queryClient, renderOptions } = providerRenderOptions(options)
  return { queryClient, ...render(ui, renderOptions) }
}

// Both loading dialogs expose controls before their content module is ready.
export async function renderWithLoadedDialogs(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): Promise<RenderWithProvidersResult> {
  await loadDeferredDialogs()
  return renderWithProviders(ui, options)
}

export async function loadDeferredDialogs() {
  await Promise.all([
    resourceQueryClient.query(paletteContentQueryOptions),
    resourceQueryClient.query(filePickerDialogQueryOptions),
  ])
}

// Keeps a deferred dialog on its loading shell until the returned release runs.
export function holdDeferredDialog(queryKey: QueryKey, load: () => Promise<unknown>) {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  resourceQueryClient.removeQueries({ exact: true, queryKey })
  void resourceQueryClient.query({
    queryKey,
    queryFn: async () => {
      await held
      return load()
    },
  })
  return release
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
  seedHtmlTheme(theme)
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
  seedHtmlTheme('dark')
  const detach = navigation.attach(application)
  const unbind = bindNavigation(navigation)
  application.start()
  const rendered = render(
    <StrictMode>
      <NavigationProvider navigation={navigation}>
        <ApplicationRuntimeProvider application={application}>
          <EnvironmentConnectionsContext value={application.connections}>
            <FocusProvider>
              <CommandBusProvider binding={application.commandBinding}>
                <ActiveEnvironmentApplication>{ui}</ActiveEnvironmentApplication>
              </CommandBusProvider>
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
      unbind()
      detach()
      navigation.dispose()
    },
  }
}
