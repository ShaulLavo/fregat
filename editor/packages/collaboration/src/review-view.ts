import type {
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewSnapshot,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'
import {
  EDITOR_HOVER_PARTICIPANT,
  type HoverPart,
} from '@singapore-editor/plugin-ui/hover-participant'
import type { MergeReview } from './review'

const gutterId = 'merge-review'

export const reviewGutter: EditorPlugin = {
  name: 'editor.merge-review-gutter',
  activate(context) {
    return context.registerGutterContribution({
      id: gutterId,
      createCell: (document) => document.createElement('span'),
      width: () => 12,
      updateCell() {},
    })
  },
}

export class ReviewView implements EditorViewContribution {
  readonly inputs = ['content', 'viewport', 'layout'] as const
  private readonly name: string
  private readonly dots = new Set<HTMLElement>()
  private readonly unsubscribe: () => void
  private readonly unregister: { dispose(): void }

  constructor(
    private readonly context: EditorViewContributionContext,
    private readonly review: MergeReview,
    private readonly displayName: (author: string) => string,
  ) {
    this.name = `${context.highlightPrefix}-merge-review`
    this.unsubscribe = review.subscribe(() => context.requestViewUpdate())
    this.unregister = context.registerProvider(
      EDITOR_HOVER_PARTICIPANT,
      { language: '*' },
      {
        computeSync: ({ anchor }) => {
          const mark = review.marks.find((mark) => {
            const range = review.range(mark)
            return anchor.offset >= range.startIndex && anchor.offset <= range.endIndex
          })
          if (!mark) return []
          const versions = review.versions(mark)
          if (!versions) return []
          const range = review.range(mark)
          const actions = [{ label: 'Keep both', run: () => review.dismiss(mark) }]
          if (review.canResolve(mark, review.peer))
            actions.push({
              label: 'Keep yours',
              run: () => {
                review.resolve(mark, review.peer)
              },
            })
          for (const author of mark.authors.filter((author) => author !== review.peer)) {
            if (!review.canResolve(mark, author)) continue
            actions.push({
              label:
                mark.authors.length === 2 && mark.authors.includes(review.peer)
                  ? 'Keep theirs'
                  : `Keep ${displayName(author)}'s edits`,
              run: () => {
                review.resolve(mark, author)
              },
            })
          }
          if (mark.authors.some((author) => !review.canResolve(mark, author)))
            actions.push({
              label: 'Jump to edit',
              run: () => {
                const offset = review.jumpOffset(mark)
                if (offset === null) return
                context.setSelection(offset, offset, 'merge-review-jump')
                context.focusEditor()
              },
            })
          const yours = versions.authors.find(({ author }) => author === review.peer)
          const theirs = versions.authors.filter(({ author }) => author !== review.peer)
          const markdown = [code('Base', versions.base)]
            .concat(
              theirs.map(({ author, text }) => code(`Theirs (${displayName(author)})`, text)),
              yours ? [code('Yours', yours.text)] : [],
            )
            .join('\n\n')
          const part: HoverPart = {
            ordinal: 10,
            presentation: 'controls',
            range: { start: range.startIndex, end: range.endIndex },
            markdown,
            notes: [{ text: `Review edits by ${mark.authors.map(displayName).join(' and ')}.` }],
            actions: actions.concat(review.options.onMergeReview?.(mark.unit, versions) ?? []),
          }
          return [part]
        },
      },
    )
  }

  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    this.clearDots()
    if (kind === 'clear' || snapshot.geometryCommitted === false) {
      this.context.clearRangeHighlight(this.name)
      return
    }
    const ranges = this.review.marks.map((mark) => ({ mark, range: this.review.range(mark) }))
    const cells = [
      ...this.context.scrollElement.querySelectorAll<HTMLElement>(
        `[data-editor-gutter-contribution="${gutterId}"]`,
      ),
    ].map((cell) => ({ cell, rect: cell.getBoundingClientRect() }))
    const markers = ranges.map(({ mark, range }) => ({
      mark,
      rect: this.context.getRangeClientRect(range.startIndex, range.startIndex),
    }))
    this.context.setRangeHighlight(
      this.name,
      ranges.map(({ range }) => ({ start: range.startIndex, end: range.endIndex })),
      {
        backgroundColor:
          'var(--editor-merge-review-background, color-mix(in srgb, var(--editor-syntax-keyword, currentColor) 18%, transparent))',
      },
    )
    const painted = new Set<HTMLElement>()
    for (const { mark, rect } of markers) {
      if (!rect) continue
      const cell = cells.find(
        ({ rect: bounds }) => rect.top >= bounds.top && rect.top < bounds.bottom,
      )?.cell
      if (!cell || painted.has(cell)) continue
      painted.add(cell)
      const dot = cell.ownerDocument.createElement('span')
      dot.className = 'editor-merge-review-dot'
      dot.setAttribute('role', 'img')
      dot.setAttribute('aria-label', 'Review merged edits')
      dot.title = 'Review merged edits'
      dot.dataset.mergeReview = mark.unitId
      cell.append(dot)
      this.dots.add(dot)
    }
  }

  private clearDots(): void {
    for (const dot of this.dots) dot.remove()
    this.dots.clear()
  }

  dispose(): void {
    this.unsubscribe()
    this.unregister.dispose()
    this.context.clearRangeHighlight(this.name)
    this.clearDots()
  }
}

function code(label: string, text: string): string {
  const fence = '`'.repeat(
    Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)),
  )
  const heading = label.replace(/[\\`*_{}[\]()#+.!<>]/g, '\\$&').replace(/[\r\n]/g, ' ')
  return `### ${heading}\n\n${fence}\n${text}\n${fence}`
}
