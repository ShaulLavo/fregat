import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import type { ProviderMcpServer, ProviderMcpSignIn, ScopedSessionRef } from '@workspace/contracts'
import { vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server as requests } from '../../../../test/msw/server'

import { SessionMcpList } from '@/features/chat/components/session-mcp-list'
import { useSessionMcp } from '@/features/chat/hooks/use-session-mcp'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { installTestClient } from '../../../../test/factories/client-binding'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import {
  DOMAIN_SESSION,
  MetadataProviderAdapter,
  makeSessionDomainFixture,
} from '../../../../test/factories/session-domain'

class SignInAdapter extends MetadataProviderAdapter {
  readonly response = Promise.withResolvers<ProviderMcpSignIn>()
  signInRequested = false

  async mcpServers(): Promise<ProviderMcpServer[]> {
    return [{ name: 'github', status: 'needs-auth', error: null }]
  }

  async signInMcpServer() {
    this.signInRequested = true
    return this.response.promise
  }
}

function McpList({ sessionRef }: { sessionRef: ScopedSessionRef }) {
  const mcp = useSessionMcp(sessionRef, false)
  return <SessionMcpList mcp={mcp} sessionRef={sessionRef} />
}

test('offers an explicit sign-in link after a delayed OAuth response without opening a popup', async () => {
  requests.use(http.get('https://models.dev/api.json', () => HttpResponse.json({})))
  const fixture = await makeSessionDomainFixture({ environmentId: TEST_ENVIRONMENT_ID })
  const adapter = new SignInAdapter()
  const client = new QueryClient()
  const restore = installTestClient(fixture.client)
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  try {
    await fixture.server.restart({ providerRuntime: true, providerAdapter: adapter })
    const registered = await fixture.register()
    if (!registered.result) throw new Error('Missing fixture worktree')
    await fixture.createSession(registered.result.worktreeId)
    await fixture.startTurn()
    await fixture.engine.providerRuntimeIdle()
    const ref = { environmentId: fixture.descriptor.environmentId, sessionId: DOMAIN_SESSION }
    client.setQueryData(sessionToolKeys.mcp(ref.environmentId, ref.sessionId), {
      running: true,
      canReconnect: false,
      canSignIn: true,
      servers: await adapter.mcpServers(),
    })
    const view = render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <McpList sessionRef={ref} />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in to github' }))
      await waitFor(() => expect(adapter.signInRequested).toBe(true))
      expect(screen.queryByRole('link')).toBeNull()
      adapter.response.resolve({ authorizationUrl: 'https://auth.example.test/login' })
      const link = await screen.findByRole('link', { name: 'Continue sign-in to github' })
      expect(link).toHaveAttribute('href', 'https://auth.example.test/login')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(popup).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  } finally {
    client.clear()
    popup.mockRestore()
    restore()
    await fixture.server.cleanup()
  }
})
