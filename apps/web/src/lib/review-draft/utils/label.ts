import { basename } from '@/lib/path-formatters'
import type { ReviewCommentAnchor } from '@workspace/client-core/chat/review-comments'

type LineRange = { readonly start: number; readonly end: number }

/** Where a comment points, short enough for a chip. */
export function reviewCommentLabel(anchor: ReviewCommentAnchor) {
  if (anchor.kind === 'plan') {
    const { end, start } = anchor.lines
    return start === end ? `Plan line ${start}` : `Plan lines ${start}–${end}`
  }
  if (anchor.kind === 'message') {
    const { end, start } = anchor.lines
    return start === end ? `Reply line ${start}` : `Reply lines ${start}–${end}`
  }
  const range = anchor.newRange ?? anchor.oldRange
  return range ? `${basename(anchor.path)}:${lineSpan(range)}` : basename(anchor.path)
}

function lineSpan(range: LineRange) {
  return range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`
}
