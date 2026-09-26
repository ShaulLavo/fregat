import { describe } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'

import { mcpServer } from '../../../../../test/factories/mcp-server'
import { mcpServerFacts } from '@/features/chat/utils/mcp-status'

describe('mcpServerFacts', () => {
  test('names the source, the HTTP origin over the transport, and the tool count', () => {
    expect(
      mcpServerFacts(
        mcpServer({
          name: 'linear',
          origin: 'https://mcp.linear.app',
          status: 'connected',
          tools: ['list_issues', 'create_issue'],
          transport: 'http',
        }),
      ),
    ).toEqual(['User', 'https://mcp.linear.app', '2 tools'])
  })

  test('keeps an unknown harness source in its own words and drops what is missing', () => {
    expect(
      mcpServerFacts(mcpServer({ name: 'x', source: 'agent', status: 'pending', transport: null })),
    ).toEqual(['agent'])
  })
})
