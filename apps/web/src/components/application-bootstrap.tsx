import { useNavigation } from '@/hooks/use-navigation'
import { readCachedEnvironmentBindings } from '@/features/chat/state/chat-projection-cache'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createBootRuntime } from '@/state/bootstrap-runtime'
import { useEffect, useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { ActiveEnvironmentApplication } from '@/components/active-environment-application'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { Button } from '@workspace/ui/components/button'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { SimulatedLatencyBridge } from '@/features/settings/components/simulated-latency-bridge'
import { FocusProvider } from '@/lib/focus/providers/provider'
import { CommandBusProvider } from '@/keymap/providers/bus-provider'
import { ApplicationRuntimeProvider } from '@/providers/application-runtime-provider'
import { EnvironmentTransportsProvider } from '@/providers/environment-transports-provider'
import { type ApplicationRuntime } from '@/state/application-runtime'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { errorMessage } from '@/lib/error-message'

export function ApplicationBootstrap({
  boot,
  children,
}: {
  readonly boot: { readonly 'workbench.density': 'compact' | 'cozy' }
  readonly children: ReactNode
}) {
  const navigation = useNavigation()
  const [application, setApplication] = useState<ApplicationRuntime | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    const cached = readCachedEnvironmentBindings(['local']).find(
      (binding) => binding.origin === primaryServerOrigin(),
    )
    let runtime: ApplicationRuntime | null = null
    let detachNavigation: (() => void) | undefined
    const attach = (owner: ApplicationRuntime) => {
      detachNavigation?.()
      detachNavigation = navigation.attach(owner)
      return owner
    }
    try {
      if (cached) runtime = attach(createBootRuntime(cached.descriptor, navigation.initial, true))
    } catch {
      // Cached metadata cannot prevent a fresh descriptor check.
    }
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect -- constructing the cached runtime starts subscriptions and must stay in the mount effect.
    if (runtime) setApplication(runtime)
    void readEnvironmentDescriptor(
      primaryServerOrigin(),
      AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
    )
      .then((descriptor) => {
        if (abort.signal.aborted) return
        if (runtime === null) runtime = attach(createBootRuntime(descriptor, navigation.initial))
        setApplication(runtime)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return
        const message = errorMessage(cause, 'Cannot connect to the local machine.')
        if (runtime)
          useEnvironmentsStore.getState().setPhase(primaryServerOrigin(), 'offline', message)
        if (!runtime) setError(message)
      })
    return () => {
      abort.abort()
      detachNavigation?.()
      runtime?.dispose()
    }
  }, [attempt, navigation])
  if (error)
    return (
      <EmptyState
        action={
          <Button onClick={() => setAttempt(attempt + 1)} size='sm' variant='outline'>
            Retry connection
          </Button>
        }
        className='min-h-svh'
        description={error}
        title='Cannot connect to the local machine'
        tone='error'
      />
    )
  if (!application)
    return (
      <div
        className='bg-background text-foreground grid min-h-svh place-content-center gap-3'
        role='status'
      >
        <RingLoader aria-hidden='true' className='mx-auto size-8' />
        <p className='text-sm'>Connecting to local machine…</p>
      </div>
    )
  return (
    <QueryClientProvider client={primaryQueryClient()}>
      <SettingsOwnerProvider queryClient={primaryQueryClient()}>
        <SimulatedLatencyBridge />
        <ApplicationRuntimeProvider application={application}>
          <EnvironmentTransportsProvider connections={application.connections}>
            <FocusProvider>
              <HotkeysProvider>
                <CommandBusProvider binding={application.commandBinding}>
                  <ActiveEnvironmentApplication bootDensity={boot['workbench.density']}>
                    {children}
                  </ActiveEnvironmentApplication>
                </CommandBusProvider>
              </HotkeysProvider>
            </FocusProvider>
          </EnvironmentTransportsProvider>
        </ApplicationRuntimeProvider>
      </SettingsOwnerProvider>
    </QueryClientProvider>
  )
}
