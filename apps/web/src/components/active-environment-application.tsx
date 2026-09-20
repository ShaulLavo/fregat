import { useSyncExternalStore, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import type { SettingsValues } from '@workspace/contracts'

import { ThemeAwareToaster } from '@/components/theme-aware-toaster'
import { ConnectionGate } from '@/features/environments/components/connection-gate'
import { EditorColorThemeProvider } from '@/features/editor/providers/color-theme-provider'
import { LanguageServerMatchProvider } from '@/features/editor/providers/language-server-match-provider'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { AppearanceProvider } from '@/features/settings/providers/appearance-provider'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'

export function ActiveEnvironmentApplication({
  bootDensity,
  children,
}: {
  readonly bootDensity: SettingsValues['workbench.density']
  readonly children: ReactNode
}) {
  const application = useApplicationRuntime()
  const active = useSyncExternalStore(application.subscribe, application.getSnapshot)

  return (
    <QueryClientProvider key={active.origin} client={active.queryClient}>
      <ConnectionGate origin={active.origin}>
        <LanguageServerMatchProvider>
          <AppearanceProvider bootDensity={bootDensity}>
            <EditorColorThemeProvider>
              <TooltipProvider>
                <EditorStateProvider runtime={active.editor}>{children}</EditorStateProvider>
                <ThemeAwareToaster />
              </TooltipProvider>
            </EditorColorThemeProvider>
          </AppearanceProvider>
        </LanguageServerMatchProvider>
      </ConnectionGate>
    </QueryClientProvider>
  )
}
