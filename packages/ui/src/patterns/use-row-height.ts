import { useLayoutEffect, useState, type RefObject } from 'react'

export function useRowHeight(containerRef?: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(rootRowHeight)

  useLayoutEffect(() => {
    const parent = containerRef?.current ?? document.documentElement
    const probe = document.createElement('div')
    probe.className = 'pointer-events-none invisible absolute h-(--density-row-height) w-0'
    probe.setAttribute('aria-hidden', 'true')
    parent.append(probe)
    const update = () => {
      const measured = probe.getBoundingClientRect().height
      if (measured > 0) setHeight(measured)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(probe)
    return () => {
      observer.disconnect()
      probe.remove()
    }
  }, [containerRef])

  return height
}

function rootRowHeight() {
  if (typeof document === 'undefined') return 1
  const style = getComputedStyle(document.documentElement)
  const value = style.getPropertyValue('--density-row-height').trim()
  const length = Number.parseFloat(value)
  const fontSize = Number.parseFloat(style.fontSize) || 1
  if (!Number.isFinite(length)) return fontSize
  return value.endsWith('rem') || value.endsWith('em') ? length * fontSize : length
}
