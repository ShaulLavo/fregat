import { expect, test } from 'vitest'
import { foreignTerminalRequests, terminalReleaseFailures } from './live-terminal.mjs'

const build = { release: 'release-a', commit: 'a'.repeat(40), dirtyFiles: 0 }
const deployed = {
  ...build,
  server: build,
  terminalHostProbe: { type: 'hello', version: 1, pid: 100, build },
}

test('accepts deployed assets and a live host with the expected protocol', () => {
  expect(terminalReleaseFailures(deployed, deployed, 1)).toEqual([])
})

test.each(['deployed', 'isolated'])('rejects an incompatible %s terminal host protocol', (name) => {
  const incompatible = {
    ...deployed,
    terminalHostProbe: { ...deployed.terminalHostProbe, version: 2 },
  }
  const target = name === 'deployed' ? incompatible : deployed
  const backend = name === 'isolated' ? incompatible : deployed
  expect(terminalReleaseFailures(target, backend, 1)).toContain(
    `terminal check: ${name} fresh terminal host reply is missing or invalid`,
  )
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
  { ...deployed.terminalHostProbe, type: 'starting' },
  { ...deployed.terminalHostProbe, version: 2 },
  { ...deployed.terminalHostProbe, pid: 0 },
  { ...deployed.terminalHostProbe, pid: '100' },
])('rejects an absent or invalid deployed terminal host %j', (terminalHostProbe) => {
  expect(terminalReleaseFailures({ ...deployed, terminalHostProbe }, deployed, 1)).toContain(
    'terminal check: deployed fresh terminal host reply is missing or invalid',
  )
})

test.each([
  { ...build, commit: 'b'.repeat(40) },
  { ...build, release: 'release-b' },
  { release: 'release-old', commit: 'b'.repeat(40), dirtyFiles: 0 },
  { ...build, dirtyFiles: 1 },
])('accepts a retained terminal host build as informational %j', (hostBuild) => {
  expect(
    terminalReleaseFailures(
      { ...deployed, terminalHostProbe: { ...deployed.terminalHostProbe, build: hostBuild } },
      deployed,
      1,
    ),
  ).toEqual([])
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

test('rejects cached identity without a fresh round-trip', () => {
  const { terminalHostProbe, ...release } = deployed
  expect(
    terminalReleaseFailures({ ...release, terminalHost: terminalHostProbe }, deployed, 1),
  ).toContain('terminal check: deployed fresh terminal host reply is missing or invalid')
})
