import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { XIcon } from '@phosphor-icons/react'
import { use, useLayoutEffect, useRef, useState } from 'react'

import type { DiagnosticPeekModel } from '@/features/editor/state/diagnostic-peek-source'
import {
  copyDiagnosticPeekClientRect,
  diagnosticPeekPlacement,
  type DiagnosticPeekPlacement,
} from '@/features/editor/utils/diagnostic-peek-placement'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { DiagnosticPeekFixButton } from '@/features/editor/components/diagnostic-peek-fix-button'
import { DiagnosticFixContext } from '@/lib/diagnostic-ai/providers/context'

type DiagnosticPeekProps = {
  readonly model: DiagnosticPeekModel
  readonly onClose: (restoreOrigin: boolean) => void
  readonly onOpenTarget?: (
    target: DiagnosticPeekModel['relatedInformation'][number]['target'],
  ) => void
  readonly tabId: string
}

export function DiagnosticPeek({ model, onClose, onOpenTarget, tabId }: DiagnosticPeekProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const canFix = use(DiagnosticFixContext) !== null
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<DiagnosticPeekPlacement | null>(null)
  const { ref: focusTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'editor',
    capabilities: { overlay: true },
    id: { key: `${tabId}:diagnostic-peek`, kind: 'editor', surface: 'document', tabId },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false
      element.querySelector<HTMLElement>('button')?.focus()
      return true
    },
  })
  // Keep the FocusService registration attached while placement updates rerender the surface.
  const setSurfaceRef = (element: HTMLDivElement | null) => {
    surfaceRef.current = element
    focusTargetRef(element)
  }

  useLayoutEffect(() => {
    const layer = layerRef.current
    const surface = surfaceRef.current
    if (!layer || !surface || model.geometry.kind !== 'visible') return
    const geometry = model.geometry

    const update = () => {
      setPlacement(
        diagnosticPeekPlacement({
          anchorRect: geometry.anchorRect,
          clipRect: geometry.clipRect,
          layerRect: copyDiagnosticPeekClientRect(layer.getBoundingClientRect()),
          surfaceHeight: surface.offsetHeight,
          surfaceWidth: surface.offsetWidth,
        }),
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(layer)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [model])

  if (model.geometry.kind !== 'visible') return null

  function openRelated(target: DiagnosticPeekModel['relatedInformation'][number]['target']): void {
    onClose(false)
    onOpenTarget?.(target)
  }

  return (
    <div className='pointer-events-none absolute inset-0 z-30' ref={layerRef}>
      <div
        aria-label={`${model.severity} diagnostic`}
        className={cn(
          'bg-popover-solid pointer-events-auto absolute overscroll-contain max-h-[calc(100%-1rem)] w-96 max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg p-3 text-sm shadow-md ring-1 ring-foreground/10',
          !placement && 'invisible',
        )}
        data-diagnostic-peek=''
        ref={setSurfaceRef}
        role='dialog'
        style={placement ?? { left: 0, top: 0 }}
      >
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='text-muted-foreground text-xs'>{model.severity}</div>
            <div className='text-foreground mt-1 whitespace-pre-wrap'>{model.message}</div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label='Close diagnostic'
                  size='icon-sm'
                  variant='ghost'
                  onClick={() => onClose(true)}
                >
                  <XIcon aria-hidden='true' />
                </Button>
              }
            />
            <TooltipContent>{'Close diagnostic'}</TooltipContent>
          </Tooltip>
        </div>
        {model.source || model.code ? (
          <div className='text-muted-foreground mt-2 text-xs'>
            {[model.source, model.code].filter(Boolean).join(' · ')}
          </div>
        ) : null}
        {canFix ? (
          <DiagnosticPeekFixButton model={model} tabId={tabId} onOpened={() => onClose(false)} />
        ) : null}
        {model.relatedInformation.length > 0 ? (
          <div className='mt-3 pt-2'>
            {model.relatedInformation.map((information, index) => (
              <Button
                className='h-auto w-full justify-start px-2 py-1.5 text-left'
                key={`${information.target.uri}:${information.line}:${information.column}:${index}`}
                title={`${information.target.path}:${information.line}:${information.column} — ${information.label}`}
                variant='ghost'
                onClick={() => openRelated(information.target)}
              >
                <span className='min-w-0 flex-1 truncate'>{information.label}</span>
                <span className='text-muted-foreground ml-2 tabular-nums'>
                  {information.line}:{information.column}
                </span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
