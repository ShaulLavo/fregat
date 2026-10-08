import { expect, test } from 'vitest'
import { capturedTerminal } from './product-terminal'

test('captures only an owned ordinary shell and retains its API base path', () => {
  const url = 'wss://example.test/platform/terminal?terminalId=proof-1&worktreeId=tree-1'
  expect(capturedTerminal(url, 'proof-')).toEqual({
    socketUrl: url,
    killUrl: 'https://example.test/platform/terminal/kill',
    worktreeId: 'tree-1',
    terminalId: 'proof-1',
  })
})

test('rejects another namespace, agent sessions and missing identities', () => {
  for (const query of [
    'terminalId=foreign-1&worktreeId=tree-1',
    'terminalId=proof-1&worktreeId=tree-1&agentSessionId=agent-1',
    'terminalId=proof-1',
    'worktreeId=tree-1',
  ])
    expect(capturedTerminal(`ws://example.test/terminal?${query}`, 'proof-')).toBeUndefined()
  expect(capturedTerminal('ws://example.test/events', 'proof-')).toBeUndefined()
})
