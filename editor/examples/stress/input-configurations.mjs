import { fail } from './errors.mjs'

export const inputConsumerIds = Object.freeze([
  'native',
  'disabled',
  'tree-sitter',
  'shiki',
  'minimap',
  'tree-sitter-shiki',
  'tree-sitter-minimap',
  'shiki-minimap',
  'all',
  'platform',
])

// Platform's large-file policy (editor.largeFile.* defaults): analysis consumers pause above
// 10 Mi UTF-16 code units and the minimap above 50 Mi, so those fixtures measure the paused set.
const miCodeUnits = 1_048_576
export const analysisLimitCodeUnits = 10 * miCodeUnits
export const minimapLimitCodeUnits = 50 * miCodeUnits

export function inputConsumerConfiguration(id, fixture, length) {
  if (!inputConsumerIds.includes(id))
    throw new TypeError(`Unknown input consumer configuration: ${id}`)
  if (!Number.isInteger(length) || length < 0) throw new TypeError('Missing fixture length')
  const native = id === 'native'
  const platform = id === 'platform'
  const analysis = native || length <= analysisLimitCodeUnits
  return {
    id,
    analysis,
    treeSitter: native
      ? fixture === 'ordinary'
      : analysis && (id.includes('tree-sitter') || id === 'all' || platform),
    shiki: analysis && (id.includes('shiki') || id === 'all' || platform),
    minimap:
      length <= minimapLimitCodeUnits && (id.includes('minimap') || id === 'all' || platform),
    find: native || platform,
    platform,
    language: 'typescript',
    theme: 'github-dark',
  }
}

const syntaxHighlight = /^editor-shared-token-/

// Shiki leaves lines over its limit as one plain token. Every view owns a live session, hidden
// ones included, so the owner reports each over-limit line once per view.
function plainFallback(readiness, check) {
  const { maxTokenizationLineLength: limit, untokenizedLines: reported } = readiness.shiki
  const overLimit = readiness.overLimitLines
  check(Number.isInteger(limit) && limit > 0, 'Shiki reports no tokenization line limit')
  check(Number.isInteger(reported) && Number.isInteger(overLimit), 'Plain-line counts are missing')
  const expected = overLimit * readiness.views.length
  check(reported === expected, `Shiki reports ${reported} plain lines, expected ${expected}`)
  return overLimit > 0
}

// A document that is only plain lines paints each line as one range per visible view, in the
// rendered text colour.
function uniformPlainOutput(tokens, readiness, check) {
  const painted = tokens.filter((entry) => entry.ranges > 0)
  const colors = new Set(painted.map((entry) => normalizedColor(entry.color)))
  check(colors.size <= 1, `plain output has ${colors.size} token colours`)
  if (colors.size === 1)
    check(
      colors.has(normalizedColor(readiness.rowColor)),
      'plain token colour differs from the text colour',
    )
  if (readiness.overLimitLines !== readiness.lineCount) return
  const visible = readiness.views.filter((view) => view.visible).length
  const ranges = painted.reduce((sum, entry) => sum + entry.ranges, 0)
  check(
    ranges === readiness.overLimitLines * visible,
    `plain output has ${ranges} ranges for ${visible} visible views`,
  )
}

function normalizedColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color ?? '')
  if (!hex) return color
  const value = Number.parseInt(hex[1], 16)
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`
}

function owner(snapshot, active, name, check) {
  if (!active) return check(snapshot === null, `${name} owner exists while disabled`)
  check(snapshot?.lifecycle === 'ready', `${name} owner is ${snapshot?.lifecycle}`)
  check(snapshot.pendingRequests === 0, `${name} has pending requests`)
  check(snapshot.lastError === null, `${name} reported an error`)
}

function workerCount(workers, pattern) {
  return workers.filter((worker) => pattern.test(worker.url)).length
}

// Proves each configured consumer is live and produced output, and that no other consumer is.
export function assertConsumerReadiness(readiness, id, fixture, length, views, scenario, opened) {
  const expected = inputConsumerConfiguration(id, fixture, length)
  const label = `${id}/${fixture}/${views}/${scenario}${opened ? ' after input' : ''}`
  const check = (condition, message) => {
    if (condition) return
    const { configuration: _, ...observed } = readiness
    fail(
      `Consumer readiness ${label}: ${message}; observed ${JSON.stringify(observed).slice(0, 2000)}`,
    )
  }
  check(
    JSON.stringify(readiness.configuration) === JSON.stringify(expected),
    'configuration differs',
  )
  const viewCount = views === 'multiple' ? 3 : 1
  check(readiness.views.length === viewCount, 'view count differs')
  owner(readiness.tree, expected.treeSitter, 'Tree-sitter', check)
  owner(readiness.shiki, expected.shiki, 'Shiki', check)
  const live = readiness.workers.filter((worker) => !worker.terminated)
  check(
    workerCount(live, /treeSitter\.worker/) === Number(expected.treeSitter),
    'Tree-sitter worker count',
  )
  check(workerCount(live, /shiki\.worker/) === Number(expected.shiki), 'Shiki worker count')
  const minimaps = live.filter((worker) => worker.minimap)
  check(
    minimaps.length === (expected.minimap ? viewCount : 0),
    `minimap worker count ${minimaps.length}`,
  )
  // Every live minimap worker, one per view, holds the current text and rendered after its last
  // source update; a sum over workers could hide one stale view.
  const receipts = readiness.minimaps ?? []
  check(
    receipts.length === minimaps.length,
    `minimap receipts ${receipts.length} for ${minimaps.length} workers`,
  )
  for (const [index, receipt] of receipts.entries()) {
    check(receipt.current, `minimap ${index} holds text that differs from the document`)
    check(
      receipt.renderedAfterSource,
      `minimap ${index} has no accepted render after its last source update`,
    )
  }
  const syntax = expected.treeSitter || expected.shiki
  const plain = expected.shiki ? plainFallback(readiness, check) : false
  const tokens = readiness.highlights.filter((entry) => syntaxHighlight.test(entry.name))
  const tokenRanges = tokens.reduce((sum, entry) => sum + entry.ranges, 0)
  if (plain) uniformPlainOutput(tokens, readiness, check)
  else check(syntax ? tokenRanges > 0 : tokens.length === 0, `syntax token ranges ${tokenRanges}`)
  for (const view of readiness.views) {
    check(
      view.initialHighlightStatus === (syntax ? 'painted' : 'plain'),
      `highlight status ${view.initialHighlightStatus}`,
    )
    check(
      expected.minimap ? view.minimapElements > 0 : view.minimapElements === 0,
      'minimap element presence',
    )
    // A hidden view mounts no rows, so its gutter and token ranges prove nothing until it is revealed.
    if (!view.visible) continue
    check(
      expected.platform ? view.gutterElements > 0 : view.gutterElements === 0,
      'gutter element presence',
    )
    viewOutput(view, readiness, { syntax, plain }, check)
  }
  consumerReceipts(readiness, expected, check)
}

// Each visible view paints its own token ranges: one per plain line when the document is only
// plain lines, some when syntax is live, none without syntax.
function viewOutput(view, readiness, { syntax, plain }, check) {
  const label = `view ${readiness.views.indexOf(view)}`
  if (!syntax) return check(view.tokenRanges === 0, `${label} has ${view.tokenRanges} token ranges`)
  if (plain && readiness.overLimitLines === readiness.lineCount)
    return check(
      view.tokenRanges === readiness.overLimitLines,
      `${label} has ${view.tokenRanges} plain ranges`,
    )
  check(view.tokenRanges > 0, `${label} has no token ranges`)
}

// Every live session of a configured consumer received the current text and its last source
// request was answered; unconfigured consumers have no sessions. Shiki opens one session per view.
function consumerReceipts(readiness, expected, check) {
  const sessions = readiness.sessions ?? []
  for (const [kind, active] of [
    ['treeSitter', expected.treeSitter],
    ['shiki', expected.shiki],
  ]) {
    const own = sessions.filter((session) => session.kind === kind)
    if (!active) {
      check(own.length === 0, `${kind} has ${own.length} live sessions while disabled`)
      continue
    }
    check(own.length > 0, `${kind} has no live session`)
    if (kind === 'shiki')
      check(
        own.length === readiness.views.length,
        `shiki has ${own.length} sessions for ${readiness.views.length} views`,
      )
    for (const [index, session] of own.entries()) {
      const label = `${kind} session ${index}`
      check(!session.failed, `${label} last source request failed`)
      check(session.answered, `${label} last source request is unanswered`)
      check(session.current, `${label} received text that differs from the document`)
      if (kind === 'treeSitter')
        check(
          session.answeredVersion === session.requestedVersion,
          `${label} answered version ${session.answeredVersion} of ${session.requestedVersion}`,
        )
    }
  }
}
