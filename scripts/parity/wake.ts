import { deepStrictEqual, notDeepStrictEqual } from 'node:assert/strict'
import { sessionWokeAt } from '../../packages/client-core/src/chat/rail/unread'
import { upstreamSnoozeInput, wakeCases as cases } from './wake-cases'
import { pin, readPinned } from './pinned'

const sourcePath = 'packages/client-runtime/src/state/threadSettled.ts'
const source = readPinned(`${sourcePath}`)
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const expected = cases.map(({ session, now }) =>
  upstream.threadWokeAt(upstreamSnoozeInput(session), { now: new Date(now).toISOString() }),
)
const actual = cases.map(({ session, now }) => sessionWokeAt(session, now))
deepStrictEqual(actual, expected)
const timerFirst = cases.map(({ session, now }, index) =>
  Date.parse(session.snoozedUntil!) <= now ? session.snoozedUntil : actual[index],
)
notDeepStrictEqual(
  timerFirst,
  expected,
  'The corpus must detect resurfacing an acknowledged early wake.',
)
console.log(
  JSON.stringify({
    pin,
    sourcePath,
    cases: cases.length,
    result: 'matched',
    negativeControl: 'rejected',
  }),
)
