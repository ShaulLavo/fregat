import { act } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { onTestFinished } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import { createRenderer } from '@/state/renderer'

test('active renders and the error fallback reuse one real root', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const renderer = createRenderer()
  let created = 0
  const create = () => {
    created += 1
    return createRoot(host)
  }
  onTestFinished(() => {
    act(() => renderer.dispose())
    host.remove()
  })

  await act(() => renderer.render(create, <div>Ready</div>))
  expect(host.textContent).toBe('Ready')
  await act(() => renderer.render(create, <div>Startup error</div>))
  expect(host.textContent).toBe('Startup error')
  expect(created).toBe(1)

  act(() => renderer.dispose())
  act(() => renderer.dispose())
  expect(renderer.disposed).toBe(true)
  expect(host.childElementCount).toBe(0)
  expect(renderer.render(create, <div>Late render</div>)).toBe(false)
  expect(created).toBe(1)
  expect(host.childElementCount).toBe(0)
})

test('a startup that settles after disposal creates no root', async () => {
  const host = document.createElement('div')
  const renderer = createRenderer()
  const ready = Promise.withResolvers<void>()
  let created = 0
  const pending = ready.promise.then(() =>
    renderer.render(
      () => {
        created += 1
        return createRoot(host)
      },
      <div>Ready</div>,
    ),
  )

  renderer.dispose()
  ready.resolve()
  expect(await pending).toBe(false)
  expect(created).toBe(0)
  expect(host.childElementCount).toBe(0)
})

test('a late startup error remains reported and creates no fallback root', async () => {
  const host = document.createElement('div')
  const renderer = createRenderer()
  const ready = Promise.withResolvers<void>()
  const reports: unknown[] = []
  let created = 0
  const pending = ready.promise.catch((cause: unknown) => {
    reports.push(cause)
    return renderer.render(
      () => {
        created += 1
        return createRoot(host)
      },
      <div>Startup error</div>,
    )
  })

  renderer.dispose()
  ready.reject('Observed startup failure')
  expect(await pending).toBe(false)
  expect(reports).toEqual(['Observed startup failure'])
  expect(created).toBe(0)
  expect(host.childElementCount).toBe(0)
})
