import '@workspace/ui/globals.css'
import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Button } from '../../components/button'
import { Switch } from '../../components/switch'
import { mount } from '../../../test/render'

let cleanup = () => {}
afterEach(async () => {
  await commands.rowPointer('body', false)
  cleanup()
  delete document.documentElement.dataset.feel
})

test('Flat preserves switch geometry and physical depth keeps keyboard focus visible', async () => {
  document.documentElement.dataset.feel = 'flat'
  const mounted = mount(
    <>
      <Switch id='flat-switch' aria-label='Toggle' />
      <Button id='physical-button'>Save</Button>
    </>,
  )
  cleanup = mounted.unmount
  await commands.rowPointer('[data-slot="switch"]', true)
  const toggle = document.querySelector('[data-slot="switch"]')!
  expect(getComputedStyle(toggle).translate).toBe('none')
  expect(getComputedStyle(toggle).scale).toBe('none')
  await commands.rowPointer('[data-slot="switch"]', false)
  document.documentElement.dataset.feel = 'seam'
  await commands.rowKey('#physical-button', ' ')
  const button = document.querySelector('#physical-button')!
  await expect.poll(() => getComputedStyle(button).boxShadow).toContain('2px')
})
