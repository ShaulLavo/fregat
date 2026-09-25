import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { vi } from 'vitest'

import { SessionMcpList } from '@/features/chat/components/session-mcp-list'
import { useSessionMcp } from '@/features/chat/hooks/use-session-mcp'
import { signInMcpServer } from '@/features/chat/transport/session-tools'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../test/factories/chat'

vi.mock('@/features/chat/transport/session-tools', () => ({
  signInMcpServer: vi.fn(),
  fetchSessionMcp: vi.fn(),
  reconnectMcpServer: vi.fn(),
}))

const ref = { environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }

function McpList() {
  const mcp = useSessionMcp(ref, false)
  return <SessionMcpList mcp={mcp} sessionRef={ref} />
}

test('offers an explicit sign-in link after a delayed OAuth response without opening a popup', async () => {
  const response = Promise.withResolvers<{ authorizationUrl: string }>()
  vi.mocked(signInMcpServer).mockReturnValueOnce(response.promise)
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  const client = new QueryClient()
  client.setQueryData(sessionToolKeys.mcp(ref.environmentId, ref.sessionId), {
    running: true,
    canReconnect: false,
    canSignIn: true,
    servers: [{ name: 'github', status: 'needs-auth', error: null }],
  })
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <McpList />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to github' }))
    await waitFor(() => expect(signInMcpServer).toHaveBeenCalledWith(ref, 'github'))
    expect(screen.queryByRole('link')).toBeNull()
    response.resolve({ authorizationUrl: 'https://auth.example.test/login' })
    const link = await screen.findByRole('link', { name: 'Continue sign-in to github' })
    expect(link).toHaveAttribute('href', 'https://auth.example.test/login')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(popup).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    client.clear()
    popup.mockRestore()
  }
})
