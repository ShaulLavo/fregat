import { wakeCases } from './wake-cases'
import { deepStrictEqual, notDeepStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  customSnooze,
  effectiveSnoozed,
  snoozePresets,
  type CustomSnoozeInput,
} from '../../packages/client-core/src/chat/rail/snooze'
import { sessionWokeAt } from '../../packages/client-core/src/chat/rail/unread'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const zones = ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Jerusalem', 'Australia/Sydney']
const pin = '7445aa733ada33e45289e5aa5055f79142556513'
const sourcePath = 'packages/client-runtime/src/state/threadSettled.ts'
strictEqual(pin, inventory.upstream_commit)

if (process.argv[2] !== '--zone') {
  const results = zones.map((zone) =>
    JSON.parse(
      execFileSync('bun', [import.meta.path, '--zone', zone], {
        encoding: 'utf8',
        env: { ...process.env, TZ: zone },
      }),
    ),
  )
  console.log(
    JSON.stringify({
      pin,
      sourcePath,
      zones: results,
      result: 'matched',
      scope: 'Pure snooze functions only; no full lifecycle claim',
    }),
  )
} else {
  await compareZone()
}

async function compareZone() {
  const source = execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${sourcePath}`], {
    encoding: 'utf8',
  })
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  const upstream = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  )
  const moments = [
    '2026-03-07T23:30:00',
    '2026-03-08T01:30:00',
    '2026-03-08T03:30:00',
    '2026-03-26T23:30:00',
    '2026-03-28T23:30:00',
    '2026-03-29T01:30:00',
    '2026-04-04T23:30:00',
    '2026-10-24T23:30:00',
    '2026-11-01T01:30:00',
    '2026-09-20T08:00:00',
    '2026-09-20T16:59:59',
    '2026-09-20T17:00:00',
    '2026-09-20T18:00:00',
    '2026-09-21T08:00:00',
    '2028-02-28T23:30:00',
  ].map((stamp) => new Date(stamp))
  const presetExpected = moments.map((now) => upstream.resolveSnoozePresets(now))
  const presetActual = moments.map(snoozePresets)
  deepStrictEqual(presetActual, presetExpected, `${process.env.TZ}: calendar presets`)
  const duplicateSunday = presetActual.map((presets, index) =>
    moments[index]!.getDay() === 0
      ? [...presets, { ...presets.find((preset) => preset.id === 'tomorrow'), id: 'next-week' }]
      : presets,
  )
  notDeepStrictEqual(duplicateSunday, presetExpected, 'Sunday duplicate negative control must fail')
  const elapsedTomorrow = presetActual.map((presets, index) =>
    presets.map((preset) => {
      if (preset.id !== 'tomorrow') return preset
      const base = new Date(moments[index]!)
      base.setHours(9, 0, 0, 0)
      return { ...preset, snoozedUntil: new Date(base.getTime() + 86_400_000).toISOString() }
    }),
  )
  if (process.env.TZ !== 'UTC')
    notDeepStrictEqual(
      elapsedTomorrow,
      presetExpected,
      'Fixed-24h calendar negative control must fail across DST',
    )

  const customInputs: CustomSnoozeInput[] = []
  for (const unit of ['minutes', 'hours', 'days'] as const) {
    for (const amount of [
      '',
      ' ',
      '0',
      '-1',
      '0.5',
      '1',
      '2',
      '24',
      '1e3',
      '0x10',
      'NaN',
      'Infinity',
      '1e300',
      '1,5',
    ]) {
      customInputs.push({ mode: 'duration', amount, unit })
    }
  }
  for (const date of [
    '2026-03-08',
    '2026-03-27',
    '2026-03-29',
    '2026-04-05',
    '2026-11-01',
    '2026-02-30',
    '2028-02-29',
    '2026-13-01',
    'bad',
    '2026-9-20',
  ]) {
    for (const time of ['01:30', '02:30', '03:30', '09:00', '24:00', 'bad'])
      customInputs.push({ mode: 'date', date, time })
  }
  const customCases = [new Date('2026-01-01T00:00:00'), ...moments, new Date(NaN)].flatMap((now) =>
    customInputs.map((input) => ({ now, input })),
  )
  const customExpected = customCases.map(({ now, input }) =>
    upstream.resolveCustomSnooze(input, now),
  )
  deepStrictEqual(
    customCases.map(({ now, input }) => customSnooze(input, now)),
    customExpected,
    `${process.env.TZ}: custom snooze`,
  )
  const uncheckedCalendar = customCases.map(({ now, input }, index) => {
    if (input.mode !== 'date') return customExpected[index]
    const date = new Date(`${input.date}T${input.time}:00`)
    return Number.isFinite(date.getTime()) && date.getTime() > now.getTime()
      ? date.toISOString()
      : null
  })
  notDeepStrictEqual(
    uncheckedCalendar,
    customExpected,
    'Calendar round-trip negative control must fail',
  )

  const effectiveCases = [...makeEffectiveCases(), ...wakeCases]
  const effectiveExpected = effectiveCases.map(({ session, now }) =>
    upstream.effectiveSnoozed(
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
  deepStrictEqual(
    effectiveCases.map(({ session, now }) => effectiveSnoozed(session, now)),
    effectiveExpected,
    `${process.env.TZ}: effective snooze`,
  )
  const inferredFromWakeTimestamp = effectiveCases.map(
    ({ session, now }) =>
      Number.isFinite(Date.parse(session.snoozedUntil ?? '')) &&
      Date.parse(session.snoozedUntil!) > now &&
      sessionWokeAt(session, now) === null,
  )
  notDeepStrictEqual(
    inferredFromWakeTimestamp,
    effectiveExpected,
    'Missing wake timestamp must not hide pending requests',
  )
  console.log(
    JSON.stringify({
      zone: process.env.TZ,
      presets: moments.length,
      custom: customCases.length,
      effective: effectiveCases.length,
      negativeControls: process.env.TZ === 'UTC' ? 3 : 4,
    }),
  )
}

function makeEffectiveCases() {
  const cases: { session: Parameters<typeof effectiveSnoozed>[0]; now: number }[] = []
  for (const snoozedAt of [null, 'invalid', '2026-09-20T10:00:00Z']) {
    for (const snoozedUntil of [null, 'invalid', '2026-09-20T12:00:00Z']) {
      appendPendingCases(cases, snoozedAt, snoozedUntil)
    }
  }
  return cases
}

function appendPendingCases(
  cases: { session: Parameters<typeof effectiveSnoozed>[0]; now: number }[],
  snoozedAt: string | null,
  snoozedUntil: string | null,
) {
  for (const pending of ['none', 'approval', 'input']) {
    for (const now of ['2026-09-20T11:00:00Z', '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z']) {
      cases.push({
        now: Date.parse(now),
        session: {
          snoozedAt,
          snoozedUntil,
          latestTurn: null,
          runtime: null,
          archivedAt: null,
          settledOverride: null,
          pendingApprovalCount: pending === 'approval' ? 1 : 0,
          pendingUserInputCount: pending === 'input' ? 1 : 0,
        },
      })
    }
  }
}
