import { test, expect, type Page } from '@playwright/test'

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
    const names = (await page.locator('.peer-header strong').allTextContents()).concat(
      await other.locator('.peer-header strong').allTextContents(),
    )
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

async function failingBroadcastExample(page: Page) {
  await page.clock.install()
  await page.addInitScript(() => {
    const heartbeat = new Set<() => void>()
    const interval = window.setInterval.bind(window)
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 500 && typeof handler === 'function') heartbeat.add(() => handler(...args))
      return interval(handler, timeout, ...args)
    }) as typeof setInterval
    const failures = new Map<number, string>()
    let nextChannel = 0
    const Channel = window.BroadcastChannel
    window.BroadcastChannel = class extends Channel {
      private readonly index = nextChannel++
      override postMessage(message: unknown) {
        const failure = failures.get(this.index)
        if (failure) throw new TypeError(failure)
        super.postMessage(message)
      }
    }
    Object.assign(window, {
      failBroadcast(message: string | undefined, index?: number) {
        for (let channel = 0; channel < nextChannel; channel++) {
          if (index !== undefined && index !== channel) continue
          if (message) failures.set(channel, message)
          else failures.delete(channel)
        }
        for (const [channel, announce] of [...heartbeat].entries())
          if (index === undefined || index === channel) announce()
      },
    })
  })
  await page.goto('/collaboration.html')
  await page.locator('#start').click()
  await expect(page.locator('.peer-header span').filter({ hasText: '2 peers' })).toHaveCount(2)
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  return (message: string | undefined, index?: number) =>
    page.evaluate(
      ({ error, channel }) => {
        const control = window as unknown as {
          failBroadcast(message: string | undefined, index?: number): void
        }
        control.failBroadcast(error, channel)
      },
      { error: message, channel: index },
    )
}

test('a connection error persists while its transport still fails', async ({ page }) => {
  const failBroadcast = await failingBroadcastExample(page)
  const status = page.locator('#status')
  await failBroadcast('Data channel failed')
  await expect(status).toHaveText('Data channel failed')
  await page.clock.runFor(100)
  await expect(status).toHaveText('Data channel failed')
  await page.clock.runFor(1000)
  await expect(status).toHaveText('Data channel failed')
})

test('connection errors are replaced and cleared only as their transports recover', async ({
  page,
}, testInfo) => {
  const failBroadcast = await failingBroadcastExample(page)
  const status = page.locator('#status')
  await failBroadcast('Peer connection stopped')
  await expect(status).toHaveText('Peer connection stopped')
  await failBroadcast('Data channel failed', 0)
  await expect(status).toHaveText('Data channel failed')
  await failBroadcast(undefined, 0)
  await expect(status).toHaveText('Peer connection stopped')
  await page.clock.runFor(100)
  await expect(status).toHaveText('Peer connection stopped')
  await failBroadcast(undefined, 1)
  await expect(status).toHaveText('Session ready. Share the invitation link to add peers.')
  await page
    .locator('.peer')
    .filter({ has: page.locator('span', { hasText: 'Ordering host' }) })
    .getByRole('button', { name: 'Leave session' })
    .click()
  await expect
    .poll(async () => {
      await page.clock.runFor(100)
      return page.locator('.peer-header span').allTextContents()
    })
    .toEqual(expect.arrayContaining(['left', 'Ordering host · 1 peers']))
  await expect(status).toHaveText('Session ready. Share the invitation link to add peers.')
  await page.screenshot({ path: testInfo.outputPath('recovered.png') })
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
