import type { LspNegotiatedSemanticTokens } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import { CONTENT_MODIFIED_CODE, REQUEST_CANCELLED_CODE } from './proxy-protocol'

/**
 * Reads a `semanticTokensProvider` out of an `initialize` result.
 *
 * `full` may be `true` or `{ delta }`, and only the object form's `delta` counts:
 * gopls returns a `resultId` on every response and then rejects `full/delta`
 * outright, so a `resultId` in a response says nothing about delta support and
 * `full.delta === true` is the only thing that does.
 */
export function negotiatedSemanticTokens(result: unknown): LspNegotiatedSemanticTokens | null {
  if (!isRecord(result)) return null
  if (!isRecord(result.capabilities)) return null

  const provider = result.capabilities.semanticTokensProvider
  if (!isRecord(provider)) return null

  const full = provider.full
  const legend = isRecord(provider.legend) ? provider.legend : {}
  return {
    delta: isRecord(full) && full.delta === true,
    full: full === true || isRecord(full),
    legend: {
      tokenModifiers: stringArray(legend.tokenModifiers),
      tokenTypes: stringArray(legend.tokenTypes),
    },
    range: provider.range === true || isRecord(provider.range),
  }
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string')
}

export const SEMANTIC_TOKENS_FULL = 'textDocument/semanticTokens/full'
export const SEMANTIC_TOKENS_DELTA = 'textDocument/semanticTokens/full/delta'

/**
 * Is this error the server saying it cannot honour our `previousResultId`?
 *
 * Only a delta request can get that answer, and only that answer justifies
 * throwing the baseline away. The two codes that dominate the hot path —
 * `-32800 RequestCancelled`, which is what every keystroke produces because the
 * browser cancels its in-flight request, and `-32801 ContentModified`, the
 * ordinary answer to asking about text that has moved — are explicitly *not*
 * evidence about the baseline. Treating them as such threw away a good baseline
 * on every keystroke and counted each one against the server.
 */
export function isRejectedBaselineError(delta: boolean, error: unknown): boolean {
  if (!delta) return false
  if (!isRecord(error)) return false
  if (error.code === REQUEST_CANCELLED_CODE || error.code === CONTENT_MODIFIED_CODE) return false

  return true
}

/**
 * Applies a `SemanticTokensDelta`'s edits to a baseline array.
 *
 * Returns `null` rather than a best effort for anything malformed. Every edit is
 * `{ start, deleteCount, data? }` over the flat uint32 array, and **every one of
 * those offsets indexes the array the server diffed against** — the previous
 * result — not the array as it is being rewritten. So the edits are validated
 * against the baseline's own length, checked for overlap, and then applied in
 * descending order of `start` so that each splice leaves every lower offset
 * exactly where the server computed it.
 *
 * Sorting rather than trusting the order given: the spec does not oblige a
 * server to emit them in any particular one, and applying two edits in the wrong
 * order silently shifts every 5-tuple after them into a stream that still decodes
 * — into plausible spans over the wrong text.
 */
export function applySemanticTokenEdits(baseline: readonly number[], edits: readonly unknown[]) {
  const parsed: { start: number; deleteCount: number; data: number[] }[] = []
  for (const edit of edits) {
    if (!isRecord(edit)) return null
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.deleteCount)) return null

    const data = edit.data === undefined ? [] : edit.data
    if (!Array.isArray(data)) return null
    if (data.some((value) => !Number.isInteger(value) || (value as number) < 0)) return null

    const start = edit.start as number
    const deleteCount = edit.deleteCount as number
    // Against the BASELINE, before anything has been spliced. Checking the
    // running array instead would let a later edit pass because an earlier one
    // had already grown it — the bound would be measuring the wrong array.
    if (start < 0 || deleteCount < 0) return null
    if (start + deleteCount > baseline.length) return null

    parsed.push({ data: data as number[], deleteCount, start })
  }

  const ordered = parsed.sort((left, right) => right.start - left.start)
  for (let index = 1; index < ordered.length; index += 1) {
    const later = ordered[index - 1]
    const earlier = ordered[index]
    if (!later || !earlier) return null
    // Two edits claiming the same region describe an array that cannot be built.
    if (earlier.start + earlier.deleteCount > later.start) return null
  }

  const next = [...baseline]
  for (const edit of ordered) next.splice(edit.start, edit.deleteCount, ...edit.data)

  // A token stream is 5-tuples. Anything else means the edits did not describe
  // the array we held, and the client must not be told otherwise.
  if (next.length % 5 !== 0) return null

  return next
}
