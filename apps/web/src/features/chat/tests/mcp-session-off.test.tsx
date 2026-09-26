import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import type { ProviderMcpServer, ScopedSessionRef } from '@workspace/contracts'
import { http, HttpResponse } from 'msw'
import type { ProviderTurnInput } from 'server/testing'
import { server as requests } from '../../../../test/msw/server'

import { SessionMcpList } from '@/features/chat/components/session-mcp-list'
import { useSessionMcp } from '@/features/chat/hooks/use-session-mcp'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { installTestClient } from '../../../../test/factories/client-binding'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { mcpServer } from '../../../../test/factories/mcp-server'
import {
  DOMAIN_SESSION,
  MetadataProviderAdapter,
  makeSessionDomainFixture,
} from '../../../../test/factories/session-domain'

class SessionOffAdapter extends MetadataProviderAdapter {
  readonly applied: string[][] = []
  readonly turns: ProviderTurnInput[] = []
  off: readonly string[] = []

  async mcpServers(): Promise<ProviderMcpServer[]> {
    return [
      mcpServer({
        name: 'linear',
        status: this.off.includes('linear') ? 'disabled' : 'connected',
      }),
    ]
  }

  async applyMcpSessionOff({ off }: { off: readonly string[] }) {
    this.off = off
    this.applied.push([...off])
  }

  override async sendTurn(input: ProviderTurnInput) {
    this.turns.push(input)
    return super.sendTurn(input)
  }
}

function McpList({ sessionRef }: { sessionRef: ScopedSessionRef }) {
  const mcp = useSessionMcp(sessionRef, false)
  return <SessionMcpList mcp={mcp} sessionRef={sessionRef} />
}

test('a server switched off stays off for the session: the binding keeps it and the next turn carries it', async () => {
  requests.use(http.get('https://models.dev/api.json', () => HttpResponse.json({})))
  const fixture = await makeSessionDomainFixture({ environmentId: TEST_ENVIRONMENT_ID })
  const adapter = new SessionOffAdapter()
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
      canTurnOff: true,
      off: [],
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
      const toggle = screen.getByRole('switch', { name: 'linear in this session' })
      expect(toggle).toBeChecked()
      fireEvent.click(toggle)
      expect(await screen.findByText('Off for this session')).toBeInTheDocument()
      expect(adapter.applied).toEqual([['linear']])
      expect(screen.getByRole('switch', { name: 'linear in this session' })).not.toBeChecked()

      await fixture.startTurn()
      await fixture.engine.providerRuntimeIdle()
      await waitFor(() => expect(adapter.turns.at(-1)?.mcpOff).toEqual(['linear']))
    } finally {
      view.unmount()
    }
  } finally {
    client.clear()
    restore()
    await fixture.server.cleanup()
  }
})
