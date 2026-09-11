import { createMemoryHistory } from '@tanstack/react-router'
import { environmentIdSchema, sessionIdSchema } from '@workspace/contracts'
import { encodePath, encodeSegment } from '@workspace/client-core/address/path-token'
import {
  emptyAddress,
  formatAddress,
  parseAddress,
  type Address,
} from '@workspace/client-core/address/grammar'
import * as v from 'valibot'
import { test, expect } from '../../../../test/fixtures'
import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { createApplicationRouter } from '@/state/router'
import { budgetAddress } from '@/features/address/utils/snapshot'
import {
  acceptedAddressIntent,
  buildAddressLocation,
  hasAvailableRoute,
  navigateAddress,
  parseRouteSearch,
  stringifyRouteSearch,
} from '@/features/address/utils/route-options'

const workspace = testWorkspaceToken('/router-proof')
const sessionId = v.parse(sessionIdSchema, '5f7f875d-6e41-5275-8927-06a9e5a4a2e1')
const environmentId = v.parse(environmentIdSchema, '499c1da4-fd11-4701-a7d1-0d19381e8fd5')
const oldObject = 'a'.repeat(40)
const newObject = 'b'.repeat(64)

const families = [
  '',
  '/workbench',
  '/workbench/settings',
  '/workbench/s',
  '/workbench/f/src/a.ts',
  '/workbench/c/src/a.ts',
  '/workbench/r/refs%2Fheads%2Fmain/src/a.ts',
  `/workbench/d/worktree/${oldObject}..${newObject}/src/a.ts`,
  `/workbench/d/staged/_..${newObject}/src/a.ts`,
  `/workbench/d/branch/${oldObject}..${newObject}/src/a.ts`,
  `/workbench/k/${sessionId}/0..2`,
  `/workbench/k/${sessionId}/0..2!turn`,
  `/workbench/k/${sessionId}/0..2/src/a.ts`,
  '/chat',
  '/chat/t/new',
  `/chat/t/${sessionId}`,
]

test.each(families)('matches concrete local and remote family %s', async (suffix) => {
  for (const prefix of [`/~${workspace}`, `/@${environmentId}/~${workspace}`]) {
    const router = createApplicationRouter({
      history: createMemoryHistory({ initialEntries: [`${prefix}${suffix}`] }),
    })
    await router.load()
    expect(hasAvailableRoute(router)).toBe(true)
    expect(router.state.matches.at(-1)?.params.workspace).toBe(workspace)
    expect(router.state.matches.at(-1)?.routeId).not.toBe('__root__')
  }
})

test.each([
  `/~${workspace}/unknown`,
  `/~${workspace}/workbench/unknown/a.ts`,
  `/~${workspace}/chat/t/invalid`,
  `/@invalid/~${workspace}/workbench`,
  '/~invalid/workbench',
  `/~${workspace}/workbench/d/arbitrary/${oldObject}..${newObject}/a.ts`,
  `/~${workspace}/workbench/d/staged/abc..def/a.ts`,
  `/~${workspace}/workbench/k/${sessionId}/9..2/a.ts`,
])('rejects unavailable required destination %s', async (href) => {
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  await router.load()
  expect(hasAvailableRoute(router)).toBe(false)
})

test('resolves the static new chat before the session parameter', async () => {
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: [`/~${workspace}/chat/t/new`] }),
  })
  await router.load()
  expect(router.state.matches.at(-1)?.routeId).toBe('/~{$workspace}/chat/t/new')
  expect(acceptedAddressIntent(router).mainChat).toEqual({ kind: 'draft' })
})

test('round-trips path tokens, ordered tabs, ref slashes, and rename metadata through Router', async () => {
  const path = 'src/percent% space Unicode-雪 @ tilde~bang!.ts'
  const renamed = encodeSegment('old/commas,equals=tilde~percent%.ts')
  const tokens = [
    `f/${encodePath(path)}`,
    `c/${encodePath(path)}`,
    `r/${encodeSegment('refs/heads/a%~雪')}/${encodePath(path)}`,
    `d/worktree/${oldObject}..${newObject},s=renamed,r=${renamed}/${encodePath(path)}`,
    `k/${sessionId}/0..2,s=renamed,r=${renamed},o=${oldObject},n=${newObject}/${encodePath(path)}`,
    `k/${sessionId}/0..2,o=${oldObject}!turn`,
  ]
  const router = createApplicationRouter({ history: createMemoryHistory() })
  await router.load()
  for (const document of tokens) {
    const address: Address = {
      ...emptyAddress(),
      workspace,
      mode: 'workbench',
      document,
      tabs: ['f/first.ts', document, 'f/last.ts'],
    }
    const location = buildAddressLocation(router, address)
    expect(location.publicHref).toBe(formatAddress(address))
    await navigateAddress(router, address)
    expect(hasAvailableRoute(router)).toBe(true)
    expect(acceptedAddressIntent(router).address).toEqual(address)
    const reloaded = createApplicationRouter({
      history: createMemoryHistory({ initialEntries: [location.publicHref] }),
    })
    await reloaded.load()
    expect(hasAvailableRoute(reloaded)).toBe(true)
    expect(acceptedAddressIntent(reloaded).address).toEqual(address)
  }
})

test('isolates malformed optional search and validates decoded references', () => {
  const parsed = parseRouteSearch(
    '?tabs=f/a.ts~@~f/b%7Ec.ts&editor=f/a%25.ts&chat=t/new&side=chat&bottom=invalid&s.q=hello&s.m=bad&log.level=bad&log.find=keep&unknown=x',
  )
  expect(parsed.tabs).toEqual([
    { kind: 'file', path: 'a.ts' },
    { kind: 'selected' },
    { kind: 'file', path: 'b~c.ts' },
  ])
  expect(parsed.editor).toEqual({ kind: 'file', path: 'a%.ts' })
  expect(parsed.chat).toEqual({ kind: 'draft' })
  expect(parsed.bottom).toBeUndefined()
  expect(parsed['s.m']).toBeUndefined()
  expect(parsed['log.level']).toBeUndefined()
  expect(stringifyRouteSearch(parsed)).toBe(
    '?tabs=f/a.ts~@~f/b%7Ec.ts&editor=f/a%25.ts&chat=t/new&side=chat&s.q=hello&log.find=keep',
  )
  expect(parseRouteSearch('?tabs=@~@').tabs).toBeUndefined()
  expect(parseRouteSearch('?tabs=-~f/a').tabs).toBeUndefined()
  expect(parseRouteSearch('?tabs=-').tabs).toEqual([])
})

test.each(['workbench', 'chat'] as const)(
  'restores compressed tabs within budget when their expanded tokens exceed it in %s',
  async (mode) => {
    const selected = `f/${Array.from({ length: 8 }, () => 'selected'.repeat(12)).join('/')}/a.ts`
    const other = `f/${Array.from({ length: 8 }, () => 'other'.repeat(20)).join('/')}/b.ts`
    const address: Address = {
      ...emptyAddress(),
      workspace,
      mode,
      document: mode === 'chat' ? `t/${sessionId}` : selected,
      editor: mode === 'chat' ? selected : null,
      tabs: [other, selected],
    }
    const budget = budgetAddress(address)
    expect([other, selected].join('~').length).toBeGreaterThan(1500)
    expect(budget.omissions).toEqual([])
    const href = formatAddress(budget.address)
    expect(href.length).toBeLessThan(4000)
    expect(new URL(href, 'http://localhost').searchParams.get('tabs')).toBe(`${other}~@`)
    const router = createApplicationRouter({
      history: createMemoryHistory({ initialEntries: [href] }),
    })
    await router.load()
    expect(hasAvailableRoute(router)).toBe(true)
    expect(acceptedAddressIntent(router).address.tabs).toEqual(address.tabs)
    expect(buildAddressLocation(router, acceptedAddressIntent(router).address).publicHref).toBe(
      href,
    )
    await navigateAddress(router, { ...address, side: 'logs' })
    router.history.back()
    await router.load()
    expect(acceptedAddressIntent(router).address.tabs).toEqual(address.tabs)
  },
)

test('captures explicit defaults before supported search middleware omits them', async () => {
  const href = `/~${workspace}/workbench?side=files&bottom=terminal&tool=git&rail=active`
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  await router.load()
  expect(acceptedAddressIntent(router).address).toMatchObject({
    side: 'files',
    bottom: 'terminal',
    tool: 'git',
    rail: 'active',
  })
  expect(buildAddressLocation(router, parseAddress(href)).publicHref).toBe(
    `/~${workspace}/workbench`,
  )
})

test('pushes destinations immediately and replaces filter edits in the current entry', async () => {
  const router = createApplicationRouter({ history: createMemoryHistory() })
  await router.load()
  const first: Address = { ...emptyAddress(), workspace, mode: 'workbench', document: 'f/a.ts' }
  const second: Address = { ...first, document: 'f/b.ts' }
  await navigateAddress(router, first)
  await navigateAddress(router, second)
  for (const query of ['h', 'he', 'hel', 'hell', 'hello']) {
    await navigateAddress(router, { ...second, search: { q: query } }, { replace: true })
  }
  expect(router.history.length).toBe(3)
  router.history.back()
  await router.load()
  expect(acceptedAddressIntent(router).address.document).toBe('f/a.ts')
  router.history.forward()
  await router.load()
  expect(acceptedAddressIntent(router).address.search).toEqual({ q: 'hello' })
})

test('keeps the deployment base path in public destinations and strips it for addressed views', async () => {
  const document = `d/worktree/${oldObject}..${newObject},s=renamed,r=old%2Fa%2Cb%25.ts/new.ts`
  const address: Address = {
    ...emptyAddress(),
    workspace,
    mode: 'workbench',
    document,
    tabs: [document],
  }
  const href = `/platform${formatAddress(address)}`
  const router = createApplicationRouter({
    basepath: '/platform/',
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  await router.load()
  expect(hasAvailableRoute(router)).toBe(true)
  expect(acceptedAddressIntent(router).address).toEqual(address)
  expect(buildAddressLocation(router, address).publicHref).toBe(href)
  await navigateAddress(router, { ...address, side: 'chat', chat: 't/new' })
  expect(router.history.location.href).toBe(
    `/platform${formatAddress({ ...address, side: 'chat', chat: 't/new' })}`,
  )
  expect(acceptedAddressIntent(router).sidebarChat).toEqual({ kind: 'draft' })
})
