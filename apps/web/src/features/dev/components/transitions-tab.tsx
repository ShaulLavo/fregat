import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@singapore-editor/core/editor'
import { Button } from '@workspace/ui/components/button'
import { Slider } from '@workspace/ui/components/slider'
import { Switch } from '@workspace/ui/components/switch'
import { Section } from '@/features/dev/components/section'
import { useTransitionsEditor } from '@/features/dev/hooks/use-transitions-editor'
import {
  STREAMED_FUNCTION,
  TRANSITION_STEPS,
  streamInsertOffset,
} from '@/features/dev/utils/transition-samples'

const BASE_DURATION_MS = 520
const SLOW_MOTION = 4
const STREAM_LINE_MS = 140

/** Text changes in a real editor with the morph plugin: steps, undo, and a streamed write. */
export function TransitionsTab() {
  const [step, setStep] = useState(0)
  const [slow, setSlow] = useState(false)
  const [bounce, setBounce] = useState(18)
  const scale = slow ? SLOW_MOTION : 1
  const { editor, containerRef } = useTransitionsEditor({
    durationMs: BASE_DURATION_MS * scale,
    bounce: bounce / 100,
  })
  const timers = useRef<number[]>([])
  useEffect(() => () => clearTimers(timers.current), [])

  const goTo = (next: number) => {
    if (!editor) return
    const count = TRANSITION_STEPS.length
    const index = ((next % count) + count) % count
    replaceAll(editor, TRANSITION_STEPS[index] ?? '')
    setStep(index)
  }

  const schedule = (delays: readonly number[], run: (index: number) => void) => {
    clearTimers(timers.current)
    timers.current = delays.map((delay, index) => window.setTimeout(() => run(index), delay))
  }

  const streamFunction = () => {
    if (!editor) return
    const delays = STREAMED_FUNCTION.map((_, index) => index * STREAM_LINE_MS * scale)
    let offset = streamInsertOffset(editor.materializeFullText())
    schedule(delays, (index) => {
      const line = STREAMED_FUNCTION[index] ?? ''
      editor.edit({ from: offset, to: offset, text: line })
      offset += line.length
    })
  }

  const writeFromScratch = () => {
    if (!editor) return
    const text = editor.materializeFullText()
    replaceAll(editor, '')
    schedule([BASE_DURATION_MS * scale * 0.6], () => replaceAll(editor, text))
  }

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-6 p-(--density-section-padding)'>
      <Section
        title='Morph'
        detail='Text that survives an edit slides to its new place, removed text fades out, and new text streams in. Undo and redo morph too.'
      >
        <div className='flex flex-wrap items-center gap-2'>
          <Button onClick={() => goTo(step - 1)}>Previous</Button>
          <Button onClick={() => goTo(step + 1)}>Next</Button>
          <span className='text-muted-foreground text-xs tabular-nums'>
            Step {step + 1} of {TRANSITION_STEPS.length}
          </span>
          <Button variant='ghost' onClick={() => editor?.dispatchCommand('undo')}>
            Undo
          </Button>
          <Button variant='ghost' onClick={() => editor?.dispatchCommand('redo')}>
            Redo
          </Button>
          <Button variant='ghost' onClick={streamFunction}>
            Stream a function
          </Button>
          <Button variant='ghost' onClick={writeFromScratch}>
            Write from scratch
          </Button>
        </div>
        <div
          className='bg-background h-[26rem] overflow-hidden rounded-md'
          data-transitions-editor
          ref={containerRef}
        />
      </Section>
      <Section title='Motion' detail='Slow motion runs every morph four times longer.'>
        <label className='flex items-center gap-2 text-xs'>
          <Switch checked={slow} onCheckedChange={setSlow} />
          Slow motion
        </label>
        <label className='flex items-center gap-3 text-xs'>
          <span className='w-14 shrink-0'>Bounce</span>
          <Slider aria-label='Bounce' max={50} min={0} value={bounce} onValueChange={setBounce} />
          <span className='w-8 text-right tabular-nums'>{bounce}</span>
        </label>
      </Section>
    </div>
  )
}

function replaceAll(editor: Editor, text: string) {
  const length = editor.getTextSnapshot().length
  editor.edit({ from: 0, to: length, text })
}

function clearTimers(timers: readonly number[]) {
  for (const timer of timers) window.clearTimeout(timer)
}
