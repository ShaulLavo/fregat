import { deepStrictEqual, notDeepStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { sessionWokeAt } from '../../packages/client-core/src/chat/rail/unread'
import { wakeCases as cases } from './wake-cases'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(pin, inventory.upstream_commit)
const sourcePath = 'packages/client-runtime/src/state/threadSettled.ts'
const source = execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${sourcePath}`], {
  encoding: 'utf8',
})
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const expected = cases.map(({ session, now }) =>
  upstream.threadWokeAt(
    {
      snoozedAt: session.snoozedAt,
      snoozedUntil: session.snoozedUntil,
      latestTurn: session.latestTurn,
      session: session.runtime,
      hasPendingApprovals: session.pendingApprovalCount > 0,
      hasPendingUserInput: session.pendingUserInputCount > 0,
    },
    { now: new Date(now).toISOString() },
  ),
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
