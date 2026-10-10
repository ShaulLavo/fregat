import { expect, test } from 'vitest'
import { foreignTerminalRequests, terminalReleaseFailures } from './live-terminal.mjs'

const build = { release: 'release-a', commit: 'a'.repeat(40), dirtyFiles: 0 }
const deployed = {
  ...build,
  server: build,
  terminalHost: { type: 'hello', version: 1, pid: 100, build },
}

test('accepts deployed assets and a live host from the verified backend commit', () => {
  expect(terminalReleaseFailures(deployed, deployed, 1)).toEqual([])
})

test('rejects a different isolated backend commit', () => {
  expect(
    terminalReleaseFailures(
      deployed,
      { ...deployed, server: { ...build, commit: 'b'.repeat(40) } },
      1,
    ),
  ).toContain('terminal check: isolated backend commit differs from deployed client')
})

test.each([undefined, null, '', 'unknown'])(
  'rejects an unverifiable deployed commit %s',
  (commit) => {
    expect(terminalReleaseFailures({ ...deployed, commit }, deployed, 1)).toContain(
      'terminal check: deployed client commit is missing',
    )
  },
)

test('rejects dirty backend artifacts even when the commit matches', () => {
  expect(
    terminalReleaseFailures(deployed, { ...deployed, server: { ...build, dirtyFiles: 1 } }, 1),
  ).toContain('terminal check: isolated backend artifacts have uncommitted changes')
})

test.each([
  null,
  { ...deployed.terminalHost, type: 'starting' },
  { ...deployed.terminalHost, version: 2 },
  { ...deployed.terminalHost, pid: 0 },
  { ...deployed.terminalHost, pid: '100' },
])('rejects an absent or invalid deployed terminal host %j', (terminalHost) => {
  expect(terminalReleaseFailures({ ...deployed, terminalHost }, deployed, 1)).toContain(
    'terminal check: deployed terminal host hello is missing or invalid',
  )
})

test.each([
  { ...build, commit: 'b'.repeat(40) },
  { ...build, release: 'release-b' },
])('rejects a terminal host from a different build %j', (hostBuild) => {
  expect(
    terminalReleaseFailures(
      { ...deployed, terminalHost: { ...deployed.terminalHost, build: hostBuild } },
      deployed,
      1,
    ),
  ).toContain('terminal check: deployed terminal host build differs from deployed server')
})

test('allows only the deployed asset origin and the exact private API origin', () => {
  expect(
    foreignTerminalRequests(
      [
        'https://example.com/assets/terminal.js',
        'http://localhost:5123/health',
        'ws://localhost:5123/terminal',
        'blob:http://localhost:5123/worker',
        'data:image/png;base64,AA',
      ],
      ['https://example.com', 'http://localhost:5123'],
    ),
  ).toEqual([])
})

test.each([
  'http://localhost:5124/terminal.js',
  'http://127.0.0.1:5123/terminal.js',
  'https://other.example/terminal.js',
  'wss://other.example/terminal',
])('rejects a dependency outside the two owned origins %s', (url) => {
  expect(foreignTerminalRequests([url], ['https://example.com', 'http://localhost:5123'])).toEqual([
    url,
  ])
})
