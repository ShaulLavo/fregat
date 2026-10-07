import { useLayoutEffect, useRef } from 'react'
import type { useVoiceInput } from '../hooks/use-voice-input'

export function ChatInputDictationStatus({
  voice,
}: {
  readonly voice: ReturnType<typeof useVoiceInput>
}) {
  const previewRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const observer = new ResizeObserver(() => followPreviewEnd(preview))
    observer.observe(preview)
    return () => observer.disconnect()
  }, [voice.pending])
  useLayoutEffect(() => {
    const preview = previewRef.current
    if (preview) followPreviewEnd(preview)
  }, [voice.preview, voice.pending, voice.phase])

  if (!voice.pending) return null
  let label = 'Starting microphone…'
  if (voice.phase === 'recording') label = 'Listening…'
  if (voice.phase === 'transcribing') label = 'Transcribing…'
  const seconds = voice.elapsedSeconds
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div className='flex min-w-0 items-center gap-2 px-3 pb-2 text-xs' data-dictation-status>
      <span className='text-muted-foreground shrink-0' role='status'>
        {label}
      </span>
      <span className='text-muted-foreground shrink-0 font-mono tabular-nums'>{elapsed}</span>
      <span
        className='text-foreground no-scrollbar scroll-pinned min-w-0 flex-1 overflow-x-auto scroll-auto whitespace-nowrap'
        data-dictation-preview
        dir='auto'
        ref={previewRef}
        title={voice.preview}
      >
        <span className='inline-flex w-max items-center gap-0.5'>
          <span>{voice.preview}</span>
          {voice.phase === 'recording' ? (
            <span
              aria-hidden='true'
              className='bg-foreground h-[1em] w-px shrink-0'
              data-dictation-caret
            />
          ) : null}
        </span>
      </span>
    </div>
  )
}

function followPreviewEnd(preview: HTMLElement) {
  const direction = getComputedStyle(preview).direction
  preview.scrollLeft = direction === 'rtl' ? -preview.scrollWidth : preview.scrollWidth
}
