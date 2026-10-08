import { test, expect } from '@playwright/test'

test('participants, hosts and the final peer can leave the example', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/collaboration.html')
  await page.locator('#start').click()
  await expect(page.locator('.peer-header span').filter({ hasText: '2 peers' })).toHaveCount(2)
  const participant = page
    .locator('.peer')
    .filter({ has: page.locator('span', { hasText: 'Participant' }) })
  await participant.getByRole('button', { name: 'Leave session' }).click()
  await expect(page.locator('.peer-header span').filter({ hasText: /^left$/ })).toHaveCount(1)
  const host = page
    .locator('.peer')
    .filter({ has: page.locator('span', { hasText: 'Ordering host' }) })
  await expect(host.locator('.peer-header span')).toContainText('1 peers')
  await host.getByRole('button', { name: 'Leave session' }).click()
  await expect(page.locator('.peer-header span').filter({ hasText: 'left' })).toHaveCount(2)
  expect(errors).toEqual([])
})

test('peers with the same base names have distinct visible names across tabs', async ({ page }) => {
  await page.goto('/collaboration.html')
  await page.locator('#start').click()
  await expect(page.locator('.peer-header span').filter({ hasText: '2 peers' })).toHaveCount(2)
  const other = await page.context().newPage()
  try {
    await other.goto(await page.locator('#invitation').inputValue())
    await other.locator('#start').click()
    await expect(page.locator('.peer-header span').filter({ hasText: '4 peers' })).toHaveCount(2)
    const names = [
      ...(await page.locator('.peer-header strong').allTextContents()),
      ...(await other.locator('.peer-header strong').allTextContents()),
    ]
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(name).toMatch(/^Peer (one|two) · [\da-f]{8}$/)
  } finally {
    await other.close()
  }
})

test('the host hands off to its connected successor', async ({ page }) => {
  await page.goto('/collaboration.html')
  await page.locator('#start').click()
  await expect(page.locator('.peer-header span').filter({ hasText: '2 peers' })).toHaveCount(2)
  await page
    .locator('.peer')
    .filter({ has: page.locator('span', { hasText: 'Ordering host' }) })
    .getByRole('button', { name: 'Leave session' })
    .click()
  await expect(page.locator('.peer-header span').filter({ hasText: 'left' })).toHaveCount(1)
  await expect(page.locator('.peer-header span').filter({ hasText: 'Ordering host' })).toHaveCount(
    1,
  )
})

test('failed setup releases its intervals, channels and editor before retry', async ({ page }) => {
  await page.addInitScript(() => {
    const active = new Set<number>()
    const channels = new Set<BroadcastChannel>()
    const interval = window.setInterval.bind(window)
    const clear = window.clearInterval.bind(window)
    window.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const timer = interval(...args)
      active.add(timer)
      return timer
    }) as typeof setInterval
    window.clearInterval = (timer) => {
      active.delete(timer!)
      clear(timer)
    }
    const Channel = window.BroadcastChannel
    window.BroadcastChannel = class extends Channel {
      constructor(name: string) {
        super(name)
        channels.add(this)
      }
      override close() {
        channels.delete(this)
        super.close()
      }
    }
    Object.assign(window, {
      collaborationResources: () => ({ intervals: active.size, channels: channels.size }),
    })
  })
  await page.goto('/collaboration.html')
  await page.locator('#signaling').fill('https://invalid.example')
  await page.locator('#admission').fill('fixture-member-token')
  const baseline = await page.evaluate(() =>
    (window as unknown as { collaborationResources(): unknown }).collaborationResources(),
  )
  await page.locator('#start').click()
  await expect(page.locator('#status')).toContainText('ws')
  await expect(page.locator('.peer')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      (window as unknown as { collaborationResources(): unknown }).collaborationResources(),
    ),
  ).toEqual(baseline)
  await page.locator('#signaling').fill('')
  await page.locator('#start').click()
  await expect(page.locator('.peer-header span').filter({ hasText: '2 peers' })).toHaveCount(2)
})

test('the ready example displays a usable invitation without a broker token', async ({ page }) => {
  await page.goto('/collaboration.html')
  await page.locator('#admission').fill('private-broker-token')
  await page.locator('#start').click()
  await expect(page.locator('#status')).toContainText('Share the invitation link')
  const invitation = page.locator('#invitation')
  await expect(invitation).toBeVisible()
  const value = await invitation.inputValue()
  expect(value).not.toBe('')
  expect(value).not.toContain('private-broker-token')
  const url = new URL(value)
  expect(url.search).toBe('')
  expect(new URLSearchParams(url.hash.slice(1)).has('secret')).toBe(true)
})
