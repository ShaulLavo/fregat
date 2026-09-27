import '@workspace/ui/globals.css'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { Drawer, DrawerContent } from '@workspace/ui/components/drawer'
import { mount } from '../../../test/render'

declare module 'vitest/browser' {
  interface BrowserCommands {
    dragBy: (selector: string, deltaY: number) => Promise<void>
  }
}

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const HEADER = '40px'

function Example({ initial }: { initial: string | number }) {
  const [point, setPoint] = useState<string | number | null>(initial)
  return (
    <Drawer
      disablePointerDismissal
      modal={false}
      open
      snapToSequentialPoints
      snapPoint={point}
      snapPoints={[HEADER, 1]}
      onOpenChange={(next, details) => {
        // As the studio does: a swipe past the lowest point rests there.
        if (next) return
        details.cancel()
        if (details.reason === 'swipe') setPoint(HEADER)
      }}
      onSnapPointChange={setPoint}
    >
      <DrawerContent aria-label='Studio'>
        <div className='h-10' data-testid='header'>
          <button type='button' onClick={() => setPoint(point === 1 ? HEADER : 1)}>
            Toggle
          </button>
        </div>
        <div className='h-40'>Body</div>
      </DrawerContent>
    </Drawer>
  )
}

async function shownHeight() {
  const popup = document.querySelector<HTMLElement>('[data-slot="drawer-content"]')!
  // Wait out the slide.
  await new Promise((resolve) => setTimeout(resolve, 400))
  return Math.round(window.innerHeight - popup.getBoundingClientRect().top)
}

it('collapses to its header and expands to its full height', async () => {
  cleanups.push(mount(<Example initial={HEADER} />).unmount)
  await expect.element(page.getByText('Body')).toBeInTheDocument()
  expect(await shownHeight()).toBe(40)

  await page.getByRole('button', { name: 'Toggle' }).click()
  expect(await shownHeight()).toBe(200)

  await page.getByRole('button', { name: 'Toggle' }).click()
  expect(await shownHeight()).toBe(40)
})

it('follows a drag between its header and its full height', async () => {
  cleanups.push(mount(<Example initial={HEADER} />).unmount)
  await expect.element(page.getByText('Body')).toBeInTheDocument()
  expect(await shownHeight()).toBe(40)

  await commands.dragBy('[data-testid="header"]', -160)
  expect(await shownHeight()).toBe(200)

  await commands.dragBy('[data-testid="header"]', 160)
  expect(await shownHeight()).toBe(40)
})

it('snaps a short drag down to its header', async () => {
  cleanups.push(mount(<Example initial={1} />).unmount)
  await expect.element(page.getByText('Body')).toBeInTheDocument()
  expect(await shownHeight()).toBe(200)

  await commands.dragBy('[data-testid="header"]', 110)
  expect(await shownHeight()).toBe(40)
})
