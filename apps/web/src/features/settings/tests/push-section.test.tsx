import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pushDeviceId } from '@workspace/contracts'
import { http, HttpResponse } from 'msw'

import { PushSection } from '@/features/settings/components/push-section'
import { SettingsPage } from '@/features/settings/components/page'
import { pushErrors } from '@/features/settings/utils/push-errors'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import type { Client } from '@/lib/client'
import { expect, test } from '../../../../test/fixtures'
import { installPushPlatform } from '../../../../test/factories/push-platform'
import { server as msw } from '../../../../test/msw/server'
import { renderWithProviders } from '../../../../test/render'

test('says why a browser without push cannot turn it on', async ({ client }) => {
  void client
  const rendered = renderWithProviders(<PushSection />)

  try {
    expect(await screen.findByText('This browser cannot receive push notifications')).toBeVisible()
    expect(await screen.findByText('No devices registered')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull()
  } finally {
    rendered.unmount()
  }
})

test('asks permission from the button, subscribes, and marks this device', async ({ client }) => {
  void client
  const platform = await installPushPlatform({ permission: 'default', holdSubscribe: true })
  const pushed: string[] = []
  msw.use(
    http.post('https://push.example.test/*', ({ request }) => {
      pushed.push(request.headers.get('content-encoding') ?? '')
      return new HttpResponse(null, { status: 201 })
    }),
  )
  const rendered = renderWithProviders(<PushSection />)

  try {
    const turnOn = await screen.findByRole('button', { name: 'Turn on for this device' })
    expect(platform.Notification.requestPermission).not.toHaveBeenCalled()
    await userEvent.click(turnOn)

    expect(
      await screen.findByRole('status', { name: 'Turning on push notifications' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /Turn on for this device/ })).toBeDisabled()
    expect(platform.Notification.requestPermission).toHaveBeenCalledOnce()
    platform.releaseSubscribe()

    const row = await findDeviceRow(await pushDeviceId(platform.endpoint))
    expect(within(row).getByText(/This device/)).toBeVisible()
    expect(await screen.findByText('This device receives push notifications.')).toBeVisible()
    expect(platform.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    await userEvent.click(within(row).getByRole('button', { name: 'Send test' }))
    expect(await within(row).findByText('Sent')).toBeVisible()
    expect(pushed).toEqual(['aes128gcm'])

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('No devices registered')).toBeVisible()
    expect(platform.subscription()).toBeNull()
    expect(await screen.findByRole('button', { name: 'Turn on for this device' })).toBeVisible()
  } finally {
    rendered.unmount()
  }
})

test('shows the push service’s answer when a test cannot be delivered', async ({ client }) => {
  void client
  const platform = await installPushPlatform({ permission: 'granted' })
  msw.use(http.post('https://push.example.test/*', () => new HttpResponse(null, { status: 410 })))
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))
    const row = await findDeviceRow(await pushDeviceId(platform.endpoint))
    await userEvent.click(within(row).getByRole('button', { name: 'Send test' }))

    const alert = await within(row).findByRole('alert')
    expect(alert).toHaveTextContent('The push service no longer accepts this device.')
    expect(alert).toHaveTextContent(
      'Remove the device, then turn push notifications on again on it.',
    )
  } finally {
    rendered.unmount()
  }
})

test('names the site setting when notifications are blocked', async ({ client }) => {
  void client
  await installPushPlatform({ permission: 'denied' })
  const rendered = renderWithProviders(<PushSection />)

  try {
    expect(await screen.findByText('Notifications are blocked for this site')).toBeVisible()
    expect(screen.getByText(/Allow notifications for this site/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull()
  } finally {
    rendered.unmount()
  }
})

test('leaves a page another service worker controls alone', async ({ client }) => {
  void client
  const platform = await installPushPlatform({
    controllerScript: `${location.origin}/mockServiceWorker.js`,
  })
  const rendered = renderWithProviders(<PushSection />)

  try {
    expect(await screen.findAllByText(pushErrors.SCOPE_TAKEN.message)).toHaveLength(1)
    const devices = rendered.queryClient.getQueryState(settingsQueryKeys.pushDevices)
    expect(devices?.dataUpdatedAt ?? 0).toBe(0)
    expect(devices?.fetchStatus ?? 'idle').toBe('idle')
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull()
    expect(screen.queryByText('Push devices could not be loaded')).toBeNull()
    expect(screen.queryByText('No devices registered')).toBeNull()
    expect(platform.serviceWorker.register).not.toHaveBeenCalled()
    expect(platform.Notification.requestPermission).not.toHaveBeenCalled()
  } finally {
    rendered.unmount()
  }
})

test('says how to answer a prompt closed without an answer', async ({ client }) => {
  void client
  const platform = await installPushPlatform({ permission: 'default', answer: 'default' })
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(pushErrors.PERMISSION_DISMISSED.message)
    expect(alert).toHaveTextContent(pushErrors.PERMISSION_DISMISSED.fix)
    expect(screen.getByRole('button', { name: 'Turn on for this device' })).toBeEnabled()
    expect(platform.pushManager.subscribe).not.toHaveBeenCalled()
  } finally {
    rendered.unmount()
  }
})

test('switches to the blocked state when the prompt is denied', async ({ client }) => {
  void client
  await installPushPlatform({ permission: 'default', answer: 'denied' })
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))

    expect(await screen.findByText(pushErrors.PERMISSION_DENIED.message)).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull(),
    )
  } finally {
    rendered.unmount()
  }
})

test('shows why the browser could not subscribe', async ({ client }) => {
  void client
  await installPushPlatform({ permission: 'granted', subscribeError: 'AbortError' })
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(pushErrors.SUBSCRIBE_FAILED.message)
    expect(alert).toHaveTextContent(pushErrors.SUBSCRIBE_FAILED.fix)
    expect(document.querySelector('[data-push-device]')).toBeNull()
  } finally {
    rendered.unmount()
  }
})

test('reuses a subscription made with the server’s key', async ({ client }) => {
  const endpoint = 'https://push.example.test/kept'
  const platform = await installPushPlatform({
    permission: 'granted',
    existing: { endpoint, applicationServerKey: await serverKey(client) },
  })
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))

    const row = await findDeviceRow(await pushDeviceId(endpoint))
    expect(within(row).getByText(/This device/)).toBeVisible()
    expect(platform.pushManager.subscribe).not.toHaveBeenCalled()
    expect(platform.existing?.unsubscribe).not.toHaveBeenCalled()
  } finally {
    rendered.unmount()
  }
})

test('replaces a subscription made with an older server key', async ({ client }) => {
  void client
  const old = 'https://push.example.test/old'
  const fresh = 'https://push.example.test/fresh'
  const olderKey = new Uint8Array(65).fill(9)
  const platform = await installPushPlatform({
    permission: 'granted',
    endpoint: fresh,
    existing: { endpoint: old, applicationServerKey: olderKey },
  })
  const rendered = renderWithProviders(<PushSection />)

  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on for this device' }))

    const row = await findDeviceRow(await pushDeviceId(fresh))
    expect(within(row).getByText(/This device/)).toBeVisible()
    expect(platform.existing?.unsubscribe).toHaveBeenCalledOnce()
    expect(platform.pushManager.subscribe).toHaveBeenCalledOnce()
    expect(document.querySelector(`[data-push-device="${await pushDeviceId(old)}"]`)).toBeNull()
  } finally {
    rendered.unmount()
  }
})

test('settings search reaches the push section by its own words', async ({ client }) => {
  void client
  const rendered = renderWithProviders(<SettingsPage />)

  try {
    await userEvent.type(await screen.findByLabelText('Search settings'), 'push devices')
    expect(await screen.findByRole('heading', { name: 'Push notifications' })).toBeVisible()
  } finally {
    rendered.unmount()
  }
})

async function findDeviceRow(id: string) {
  await waitFor(() => expect(document.querySelector(`[data-push-device="${id}"]`)).not.toBeNull())
  return document.querySelector<HTMLElement>(`[data-push-device="${id}"]`) as HTMLElement
}

async function serverKey(client: Client) {
  const { data } = await client.push.devices.get()
  expect(data?.publicKey).toBeTruthy()
  return new Uint8Array(Buffer.from(data?.publicKey ?? '', 'base64url'))
}
