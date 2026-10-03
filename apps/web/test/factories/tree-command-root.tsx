import { createRoot, type Root } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { FocusProvider } from '@/lib/focus/providers/provider'
import { TestCommandProvider } from './command-runtime'

export function createTreeTestRoot(container: HTMLElement): Root {
  const root = createRoot(container)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    render(children) {
      root.render(
        <FocusProvider>
          <TestCommandProvider queryClient={queryClient}>{children}</TestCommandProvider>
        </FocusProvider>,
      )
    },
    unmount() {
      root.unmount()
      queryClient.clear()
    },
  }
}
