import '@workspace/ui/globals.css'
import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { mount } from '../../../test/render'

declare module 'vitest/browser' {
  interface BrowserCommands {
    rowPointer(selector: string, pressed: boolean): Promise<void>
  }
}

const CLEAR = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)'
const cleanups: Array<() => void> = []
afterEach(async () => {
  await commands.rowPointer('body', false)
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

function Scroller({
  rows,
  className = '',
}: {
  readonly rows: number
  readonly className?: string
}) {
  return (
    <div id='scroller' className={`scroll-fade h-40 w-60 overflow-y-auto ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div className='h-6' key={index}>
          Row {index}
        </div>
      ))}
    </div>
  )
}

function render(rows: number, className?: string) {
  const mounted = mount(<Scroller rows={rows} className={className} />)
  cleanups.push(mounted.unmount)
  return mounted.container.querySelector<HTMLElement>('#scroller')!
}

async function frames() {
  for (let index = 0; index < 3; index += 1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
}

function fade(element: HTMLElement) {
  const style = getComputedStyle(element)
  return {
    top: style.getPropertyValue('--scroll-fade-top'),
    bottom: style.getPropertyValue('--scroll-fade-bottom'),
  }
}

it('fades only the edge content lies past', async () => {
  const scroller = render(100)
  await frames()
  expect(fade(scroller)).toEqual({ top: '0px', bottom: '24px' })

  scroller.scrollTop = 600
  await frames()
  expect(fade(scroller)).toEqual({ top: '24px', bottom: '24px' })

  scroller.scrollTop = scroller.scrollHeight
  await frames()
  expect(fade(scroller)).toEqual({ top: '24px', bottom: '0px' })
})

it('leaves a list that fits crisp', async () => {
  const scroller = render(3)
  await frames()
  expect(fade(scroller)).toEqual({ top: '0px', bottom: '0px' })
})

it('shows the thin thumb only while the pointer is inside', async () => {
  const scroller = render(100)
  expect(getComputedStyle(scroller).scrollbarWidth).toBe('thin')
  expect(getComputedStyle(scroller).scrollbarColor).toBe(CLEAR)

  await commands.rowPointer('#scroller', false)
  expect(getComputedStyle(scroller).scrollbarColor).not.toBe(CLEAR)
})

it('keeps a pinned view thumbless under the pointer', async () => {
  const scroller = render(100, 'scroll-pinned')
  await commands.rowPointer('#scroller', false)
  expect(getComputedStyle(scroller).scrollbarColor).toBe(CLEAR)
  expect(getComputedStyle(scroller).scrollbarWidth).toBe('thin')
})
