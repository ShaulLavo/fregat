import { expect, it } from 'vitest'
import { matchesOrchestrationRpc } from './orchestration-url'

const cases = ['ws', 'wss', 'http', 'https'].flatMap((protocol) =>
  [
    { path: '/orchestration/rpc', expected: true },
    { path: '/orchestration/rpc?instance=x', expected: true },
    { path: '/platform/orchestration/rpc', expected: true },
    { path: '/platform/orchestration/rpc?instance=x', expected: true },
    { path: '/platform/orchestration/rpc-extra', expected: false },
    { path: '/platform/orchestration/rpc/child', expected: false },
    { path: '/platform/orchestration/rpc/', expected: false },
    { path: '/platform/terminal?next=/orchestration/rpc', expected: false },
    { path: '/platform/terminal?next=/orchestration/rpc?instance=x', expected: false },
  ].map(({ path, expected }) => ({ url: `${protocol}://localhost:33780${path}`, expected })),
)

it.each(cases)('matches $url as $expected', ({ url, expected }) => {
  expect(matchesOrchestrationRpc(new URL(url))).toBe(expected)
})
