import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import type { ProviderMcpServer, ScopedSessionRef } from '@workspace/contracts'
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
import { mcpServer } from '../../../../test/factories/mcp-server'

const AUTHORIZATION =
  'https://auth.example.test/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2Fcallback&state=s-1'

type SignInFlow = {
  authorizationUrl: string
  done: Promise<void>
  finish: (callbackUrl: URL) => Promise<void>
  cancel: () => void
}

class SignInAdapter extends MetadataProviderAdapter {
  readonly response = Promise.withResolvers<SignInFlow>()
  readonly finished: string[] = []
  readonly outcome = Promise.withResolvers<void>()
  signInRequested = false

  async mcpServers(): Promise<ProviderMcpServer[]> {
    return [
      mcpServer({
        auth: 'signed-out',
        name: 'github',
        origin: 'https://api.github.test',
        status: 'needs-auth',
        transport: 'http',
      }),
    ]
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

test('offers the sign-in page after a delayed OAuth response, and finishes with a pasted address', async () => {
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
      adapter.response.resolve({
        authorizationUrl: AUTHORIZATION,
        cancel: () => adapter.outcome.reject(new Error('cancelled')),
        done: adapter.outcome.promise,
        finish: async (callbackUrl) => {
          adapter.finished.push(callbackUrl.href)
          adapter.outcome.resolve()
        },
      })
      const link = await screen.findByRole('link', { name: 'Open sign-in page for github' })
      expect(link).toHaveAttribute('href', AUTHORIZATION)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(popup).not.toHaveBeenCalled()

      // From a phone the page ends on the server's loopback; the pasted address finishes there.
      fireEvent.change(screen.getByLabelText(/Paste that address here/), {
        target: { value: 'http://localhost:43111/callback?code=c&state=s-1' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
      expect(await screen.findByText('Signed in to github')).toBeInTheDocument()
      expect(adapter.finished).toEqual(['http://127.0.0.1:43111/callback?code=c&state=s-1'])
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
