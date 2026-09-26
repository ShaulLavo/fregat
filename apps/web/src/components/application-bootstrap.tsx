import { finishReloadBudget } from '@/lib/reload-budget'
import { log } from '@/lib/client-logging'
import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { createBootstrap } from '@/state/bootstrap'
import { QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { ActiveEnvironmentApplication } from '@/components/active-environment-application'
import { StatusFrame } from '@workspace/ui/patterns/status-frame'
import { Button } from '@workspace/ui/components/button'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { SimulatedLatencyBridge } from '@/features/settings/components/simulated-latency-bridge'
import { FocusProvider } from '@/lib/focus/providers/provider'
import { CommandBusProvider } from '@/keymap/providers/bus-provider'
import { ApplicationRuntimeProvider } from '@/providers/application-runtime-provider'
import { EnvironmentTransportsProvider } from '@/providers/environment-transports-provider'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function ApplicationBootstrap({
  bootstrap,
  children,
}: {
  readonly bootstrap: ReturnType<typeof createBootstrap>
  readonly children: ReactNode
}) {
  const { application, error } = useStore(bootstrap)
  useEffect(() => {
    bootstrap.start()
    return bootstrap.stop
  }, [bootstrap])
  useEffect(() => {
    if (!application && !error) return
    const report = finishReloadBudget()
    if (report)
      log.info({
        action: 'app.reload',
        area: 'app',
        outcome: application ? 'prepared' : 'failed',
        ...report,
      })
  }, [application, error])
  if (error)
    return (
      <StatusFrame
        action={<Button onClick={bootstrap.retry}>Retry connection</Button>}
        detail={error}
        title='Cannot connect to the local machine'
        tone='error'
      />
    )
  if (!application) return <StatusFrame title='Connecting to local machine…' tone='pending' />
  return (
    <QueryClientProvider client={primaryQueryClient()}>
      <SettingsOwnerProvider queryClient={primaryQueryClient()}>
        <SimulatedLatencyBridge />
        <ApplicationRuntimeProvider application={application}>
          <EnvironmentTransportsProvider connections={application.connections}>
            <FocusProvider>
              <HotkeysProvider>
                <CommandBusProvider binding={application.commandBinding}>
                  <ActiveEnvironmentApplication>{children}</ActiveEnvironmentApplication>
                </CommandBusProvider>
              </HotkeysProvider>
            </FocusProvider>
          </EnvironmentTransportsProvider>
        </ApplicationRuntimeProvider>
      </SettingsOwnerProvider>
    </QueryClientProvider>
  )
}
