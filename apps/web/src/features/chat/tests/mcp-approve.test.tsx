import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import type { ProviderMcpServer, ScopedSessionRef } from '@workspace/contracts'
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

class GatedAdapter extends MetadataProviderAdapter {
  readonly approved: string[] = []

  async mcpServers(): Promise<ProviderMcpServer[]> {
    return [
      {
        name: 'deploy',
        status: this.approved.includes('deploy') ? 'connected' : 'unapproved',
        error: null,
      },
    ]
  }

  async approveMcpServer({ name }: { name: string }) {
    this.approved.push(name)
  }
}

function McpList({ sessionRef }: { sessionRef: ScopedSessionRef }) {
  const mcp = useSessionMcp(sessionRef, false)
  return <SessionMcpList mcp={mcp} sessionRef={sessionRef} />
}

test('a project server waits as Not approved until Approve, then shows what the session reports', async () => {
  requests.use(http.get('https://models.dev/api.json', () => HttpResponse.json({})))
  const fixture = await makeSessionDomainFixture({ environmentId: TEST_ENVIRONMENT_ID })
  const adapter = new GatedAdapter()
  const client = new QueryClient()
  const restore = installTestClient(fixture.client)
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
      canSignIn: false,
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
      expect(screen.getByText('Not approved')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Approve deploy' }))
      expect(await screen.findByText('Connected')).toBeInTheDocument()
      expect(adapter.approved).toEqual(['deploy'])
      expect(screen.queryByRole('button', { name: 'Approve deploy' })).toBeNull()
    } finally {
      view.unmount()
    }
  } finally {
    client.clear()
    restore()
    await fixture.server.cleanup()
  }
})
