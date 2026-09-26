import { useState } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@workspace/ui/components/resizable'
import { WidthHandle } from '@workspace/ui/patterns/width-handle'

import { Section } from '@/features/dev/components/section'

const STRIP_COLUMNS = ['First', 'Second', 'Third'] as const

/** The panel handle and the pixel-width handle side by side, to compare tint, focus and drag. */
export function HandlesTab() {
  const [widths, setWidths] = useState<readonly number[]>([200, 200, 200])

  function resize(index: number, width: number) {
    setWidths((current) => current.map((value, at) => (at === index ? width : value)))
  }

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-6 p-(--density-section-padding)'>
      <Section detail='Percent panels in a group: ResizableHandle.' title='Panel handle'>
        <ResizablePanelGroup className='bg-background h-32' id='dev-handles'>
          <ResizablePanel className='p-(--density-section-padding) text-xs' minSize={120}>
            Left
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel className='p-(--density-section-padding) text-xs' minSize={120}>
            Right
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>
      <Section
        detail='Pixel columns in a scrolling strip: WidthHandle. Drag it, use the arrow keys once focused, or double-click to reset.'
        title='Column handle'
      >
        <div className='bg-background flex h-32 overflow-x-auto'>
          {STRIP_COLUMNS.map((label, index) => (
            <div
              className='relative shrink-0 p-(--density-section-padding) text-xs'
              key={label}
              style={{ width: widths[index] }}
            >
              {label} · <span className='font-mono tabular-nums'>{widths[index]}px</span>
              <WidthHandle
                label={`Resize ${label} column`}
                max={480}
                min={120}
                width={widths[index] ?? 200}
                onFit={() => resize(index, 200)}
                onResize={(width) => resize(index, width)}
              />
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
