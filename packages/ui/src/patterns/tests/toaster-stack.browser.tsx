import '@workspace/ui/globals.css'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { toast } from 'sonner'
import { Toaster } from '@workspace/ui/components/sonner'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => {
  toast.dismiss()
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

const opacities = () =>
  [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].map(
    (element) => getComputedStyle(element).opacity,
  )

it('collapsed, three toasts peek out; expanded, every toast shows', async () => {
  cleanups.push(mount(<Toaster />).unmount)
  for (let index = 1; index <= 8; index++) toast(`Notice ${index}`, { duration: Infinity })
  await expect.poll(() => document.querySelectorAll('[data-sonner-toast]').length).toBe(8)
  await expect.poll(opacities).toEqual(['1', '1', '1', '0', '0', '0', '0', '0'])
  await userEvent.hover(page.getByText('Notice 8'))
  await expect.poll(opacities).toEqual(Array(8).fill('1'))
  await expect.element(page.getByText('Notice 1')).toBeVisible()
})
