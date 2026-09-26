import { afterEach, expect, it } from 'vitest'
import { TOOLTIP_DELAY } from '@workspace/ui/components/tooltip'
import { useTooltipLayer } from '@workspace/ui/patterns/use-tooltip-layer'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function Probe() {
  const target = useTooltipLayer('probe')
  return <output>{target?.text ?? ''}</output>
}

// A control inside a shadow root, as the file tree renders its rows.
function shadowControl(label: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const control = document.createElement('span')
  control.dataset.tooltip = label
  const icon = document.createElement('i')
  control.append(icon)
  host.attachShadow({ mode: 'open' }).append(control)
  cleanups.push(() => host.remove())
  return icon
}

function dispatch(target: EventTarget, type: string) {
  target.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY + 50))
}

it('opens for a control inside a shadow root on pointer moves alone', async () => {
  const mounted = mount(<Probe />)
  cleanups.push(mounted.unmount)
  const icon = shadowControl('Fix with AI')

  dispatch(icon, 'pointermove')
  await settle()

  expect(mounted.container.querySelector('output')?.textContent).toBe('Fix with AI')

  dispatch(document.body, 'pointermove')
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(mounted.container.querySelector('output')?.textContent).toBe('')
})

it('stays hidden over a pressed control until the pointer leaves it', async () => {
  const mounted = mount(<Probe />)
  cleanups.push(mounted.unmount)
  const icon = shadowControl('Fix with AI')
  const output = () => mounted.container.querySelector('output')?.textContent

  dispatch(icon, 'pointermove')
  await settle()
  dispatch(icon, 'pointerdown')
  dispatch(icon, 'pointermove')
  await settle()
  expect(output()).toBe('')

  dispatch(document.body, 'pointermove')
  dispatch(icon, 'pointermove')
  await settle()
  expect(output()).toBe('Fix with AI')
})
