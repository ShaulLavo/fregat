import { Fragment } from 'react'

import { AnsiText } from '@/components/ansi-text'
import { StackFrameLink } from '@/features/chat/components/stack-frame-link'
import { ansiPlainText } from '@/lib/ansi-spans'
import { stackFrameSegments, stackFrames } from '@/features/chat/utils/stack-frames'

/** Tool output lines: frames open the editor, colour survives where the output carried it. */
export function ActivityOutputText({ text }: { text: string }) {
  return text.split('\n').map((line, index) => (
    // Lines never reorder, so the index is the position.
    <Fragment key={index}>
      {index > 0 ? '\n' : null}
      {outputLine(line)}
    </Fragment>
  ))
}

function outputLine(line: string) {
  const plain = ansiPlainText(line)
  if (stackFrames(plain).length === 0) return <AnsiText text={line} />

  return stackFrameSegments(plain).map((segment, index) => {
    if (!segment.frame) return segment.text
    if (segment.frame.external) {
      return (
        <span className='text-muted-foreground' key={index}>
          {segment.text}
        </span>
      )
    }

    return <StackFrameLink frame={segment.frame} key={index} text={segment.text} />
  })
}
