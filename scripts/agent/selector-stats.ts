import { mainThread, readTrace, traceNumber, traceRecord, type TraceEvent } from './trace-types'

type SelectorTiming = {
  readonly selector: string
  elapsedUs: number
  attempts: number
  matches: number
}

export function summarizeSelectors(raw: string) {
  const events = readTrace(raw)
  const main = mainThread(events)
  const onMain = events.filter((event) => event.pid === main.pid && event.tid === main.tid)
  const marks = onMain
    .filter(
      (event) => event.name === 'fregat:scenario:start' || event.name.startsWith('fregat:step:'),
    )
    .sort((a, b) => a.ts - b.ts)
  const phases = Object.fromEntries(
    marks.flatMap((mark, index) => {
      const previous = marks[index - 1]
      if (!previous) return []
      return [
        [
          mark.name.replace('fregat:step:', ''),
          selectorStatistics(
            onMain.filter((event) => event.ts >= previous.ts && event.ts < mark.ts),
          ),
        ],
      ]
    }),
  )
  return {
    warning:
      'Selector instrumentation inflates timings. Use ordinary traces for performance comparisons.',
    ...selectorStatistics(onMain),
    phases,
  }
}

function selectorStatistics(events: readonly TraceEvent[]) {
  const selectors = new Map<string, SelectorTiming>()
  let count = 0
  for (const event of events) {
    if (event.name !== 'SelectorStats') continue
    count += 1
    const timings = traceRecord(event.args.selector_stats).selector_timings
    if (!Array.isArray(timings)) continue
    for (const value of timings) addTiming(selectors, value)
  }
  const all = [...selectors.values()]
  return {
    events: count,
    selectors: all.length,
    byTime: all.toSorted((a, b) => b.elapsedUs - a.elapsedUs).slice(0, 30),
    byAttempts: all.toSorted((a, b) => b.attempts - a.attempts).slice(0, 30),
    all: all.sort((a, b) => a.selector.localeCompare(b.selector)),
  }
}

function addTiming(selectors: Map<string, SelectorTiming>, value: unknown) {
  const data = traceRecord(value)
  if (typeof data.selector !== 'string') return
  const timing = selectors.get(data.selector) ?? {
    selector: data.selector,
    elapsedUs: 0,
    attempts: 0,
    matches: 0,
  }
  timing.elapsedUs += traceNumber(data['elapsed (us)'])
  timing.attempts += traceNumber(data.match_attempts)
  timing.matches += traceNumber(data.match_count)
  selectors.set(timing.selector, timing)
}
