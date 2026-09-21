import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import { paintTerminalViewport, type TerminalScrollbar } from 'ghostty-webgpu'
import { DEFAULT_MONO_FONT_STACK } from '@/lib/default-nerd-font'

export function SavedViewport({
  paint,
  fontSize,
  onAdmitted,
  onRejected,
}: {
  paint: string
  fontSize: number
  onAdmitted: (scrollbar: Readonly<TerminalScrollbar>) => void
  onRejected: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const admitted = useEffectEvent(onAdmitted)
  const rejected = useEffectEvent(onRejected)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const view = paintTerminalViewport(host, paint, {
      font: { family: DEFAULT_MONO_FONT_STACK, size: fontSize },
    })
    if (!view) {
      rejected()
      return
    }
    admitted(view.scrollbar)
    const width = host.clientWidth
    const height = host.clientHeight
    const ratio = window.devicePixelRatio
    let invalidated = false
    const checkGeometry = () => {
      if (invalidated) return
      if (
        host.clientWidth === width &&
        host.clientHeight === height &&
        window.devicePixelRatio === ratio
      )
        return
      invalidated = true
      rejected()
    }
    const observer = new ResizeObserver(checkGeometry)
    observer.observe(host)
    window.addEventListener('resize', checkGeometry)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', checkGeometry)
      view.dispose()
    }
  }, [paint, fontSize])
  return (
    <div
      ref={ref}
      aria-label='Saved terminal output'
      role='img'
      data-terminal-presentation='saved'
      className='pointer-events-none absolute inset-0 overflow-hidden px-(--density-control-padding-x) py-(--density-section-gap) font-mono'
    />
  )
}
