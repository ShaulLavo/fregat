import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { test, expect } from '../../../../test/fixtures'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { addressHrefFromBrowser, browserAddressHref } from '@/features/address/utils/browser-url'

test('keeps mesh navigation inside its mount and restores the same address', () => {
  const href = `/~${testWorkspaceToken('platform')}/workbench/f/src/a.ts?tabs=f/src/a.ts~f/src/b.ts#L3`
  const browserHref = browserAddressHref(href, '/platform/')

  expect(browserHref).toBe(`/platform${href}`)
  expect(addressHrefFromBrowser(browserHref, '/platform/')).toBe(href)
  expect(parseAddress(addressHrefFromBrowser(browserHref, '/platform/')).workspace).toBe(
    testWorkspaceToken('platform'),
  )
})

test.for(['/', '/platform/', '/nested/platform/'])('recognizes the launch URL at %s', (base) => {
  expect(addressHrefFromBrowser(`https://mesh.example${base}`, base)).toBe('/')
  expect(browserAddressHref('/', base)).toBe(base)
})

test('does not mistake a similarly named path for the deployment prefix', () => {
  expect(
    addressHrefFromBrowser(
      `/platform-other/~${testWorkspaceToken('/repo')}/workbench`,
      '/platform/',
    ),
  ).toBe(`/platform-other/~${testWorkspaceToken('/repo')}/workbench`)
})
