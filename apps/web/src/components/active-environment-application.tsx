import { useSyncExternalStore, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { TooltipLayer } from '@workspace/ui/patterns/tooltip-layer'

import { Toaster } from '@workspace/ui/components/sonner'
import { ConnectionGate } from '@/features/environments/components/connection-gate'
import { EditorColorThemeProvider } from '@/features/editor/providers/color-theme-provider'
import { LanguageServerMatchProvider } from '@/features/editor/providers/language-server-match-provider'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { AppearanceProvider } from '@/features/settings/providers/appearance-provider'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { ErrorActionProvider } from '@/providers/error-action-provider'

export function ActiveEnvironmentApplication({ children }: { readonly children: ReactNode }) {
  const application = useApplicationRuntime()
  const active = useSyncExternalStore(application.subscribe, application.getSnapshot)

  return (
    <QueryClientProvider key={active.origin} client={active.queryClient}>
      <ErrorActionProvider>
        <ConnectionGate origin={active.origin}>
          <LanguageServerMatchProvider>
            <AppearanceProvider>
              <EditorColorThemeProvider>
                <TooltipProvider>
                  <EditorStateProvider runtime={active.editor}>{children}</EditorStateProvider>
                  <Toaster />
                  <TooltipLayer />
                </TooltipProvider>
              </EditorColorThemeProvider>
            </AppearanceProvider>
          </LanguageServerMatchProvider>
        </ConnectionGate>
      </ErrorActionProvider>
    </QueryClientProvider>
  )
}
