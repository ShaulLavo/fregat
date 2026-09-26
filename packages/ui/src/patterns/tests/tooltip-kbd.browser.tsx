import '@workspace/ui/globals.css'
import { afterEach, expect, it } from 'vitest'
import { Kbd } from '@workspace/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function popup(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')].find(
    (element) => element.textContent?.startsWith(label),
  )
}

// The padding token reserved for a key chip only works while something renders the slot.
it('tightens a tooltip that ends in a key chip', async () => {
  const mounted = mount(
    <>
      <Tooltip open>
        <TooltipTrigger>plain</TooltipTrigger>
        <TooltipContent>Plain</TooltipContent>
      </Tooltip>
      <Tooltip open>
        <TooltipTrigger>chip</TooltipTrigger>
        <TooltipContent>
          Settings
          <Kbd>Ctrl+,</Kbd>
        </TooltipContent>
      </Tooltip>
    </>,
  )
  cleanups.push(mounted.unmount)
  await expect.poll(() => popup('Settings')).toBeTruthy()
  const plain = parseFloat(getComputedStyle(popup('Plain')!).paddingRight)
  const chip = parseFloat(getComputedStyle(popup('Settings')!).paddingRight)
  expect(chip).toBeLessThan(plain)
  expect(getComputedStyle(popup('Settings')!.querySelector('kbd')!).fontFamily).not.toBe(
    getComputedStyle(popup('Settings')!).fontFamily,
  )
})
