import { expect, test } from 'vitest'

import { BASELINE_DEFECTS, MARKDOWN_CASES, type MarkdownCase } from '../../../test/fixtures/cases'
import {
  checkExpectations,
  createRemarkReplay,
  observeHast,
  renderRemark,
} from '../../../test/qualification'
import {
  adversarialUtf16,
  everyPrefix,
  seededChunks,
  utf8Chunks,
  type StreamFrame,
} from '../../../test/schedules'

const STREAM_CASES = MARKDOWN_CASES.filter((fixture) => fixture.checkpoints.length > 0)
const EXPECTED_CHECKPOINT_CASES = STREAM_CASES.filter(
  (fixture) => !BASELINE_DEFECTS.some((defect) => defect.fixtureId === fixture.id),
)
const EXHAUSTIVE_CASES = STREAM_CASES

test.each(EXPECTED_CHECKPOINT_CASES)(
  '$id: named live checkpoints match independent product expectations',
  (fixture) => {
    const replay = createRemarkReplay()
    for (const checkpoint of fixture.checkpoints) {
      const observation = observeHast(
        replay.update(fixture.source.slice(0, checkpoint.offset), checkpoint.live),
      )
      expect(checkExpectations(observation, checkpoint.expected), checkpoint.name).toEqual([])
      for (const text of checkpoint.textIncludes ?? [])
        expect(observation.text, checkpoint.name).toContain(text)
      for (const text of checkpoint.textExcludes ?? [])
        expect(observation.text, checkpoint.name).not.toContain(text)
    }
    expect(replay.update(fixture.source, false)).toEqual(renderRemark(fixture.source, false))
  },
)

test.fails.each(BASELINE_DEFECTS)(
  '$fixtureId/$checkpointId: retains the independently expected render while the baseline defect is open',
  (defect) => {
    expect(
      checkExpectations(observeHast(renderRemark('**outside *inside', true)), defect.expected),
    ).toEqual([])
  },
)

test('the tracked baseline defect reproduces the exact leaked outer marker', () => {
  expect(observeHast(renderRemark('**outside *inside', true)).text).toBe('**outside inside')
})

test.each(EXHAUSTIVE_CASES)(
  '$id: every scalar prefix keeps raw and healed incremental output equal to fresh output',
  (fixture) => {
    compareSchedule(fixture, everyPrefix(fixture.source))
  },
)

test.each(MARKDOWN_CASES)(
  '$id: eight deterministic chunk schedules settle to the completed source',
  (fixture) => {
    for (let seed = 0; seed < 8; seed += 1) {
      compareSchedule(fixture, seededChunks(fixture.source, { seed, maxUnits: 24 }))
    }
  },
)

test.each(
  MARKDOWN_CASES.filter(
    (fixture) =>
      fixture.tags.includes('unicode') ||
      fixture.tags.includes('cjk') ||
      fixture.tags.includes('rtl'),
  ),
)(
  '$id: byte transport decoding and adversarial UTF-16 splits are separate replay profiles',
  (fixture) => {
    compareSchedule(fixture, utf8Chunks(fixture.source, { seed: 42, maxBytes: 1 }))
    compareSchedule(fixture, adversarialUtf16(fixture.source))
  },
)

test('schedules cover exact source, reproduce seeds and avoid surrogate splits in normal chunks', () => {
  const source = 'A👩🏽‍💻e\u0301\r\nB'
  const frames = Array.from(seededChunks(source, { seed: 17, maxUnits: 3 }))
  expect(frames).toEqual(Array.from(seededChunks(source, { seed: 17, maxUnits: 3 })))
  expect(frames.at(-1)).toEqual({ offset: source.length, text: source })
  expect(Array.from(everyPrefix(source)).at(-1)?.text).toBe(source)
  expect(Array.from(utf8Chunks(source, { seed: 1, maxBytes: 1 })).at(-1)?.text).toBe(source)
  expect(frames.every((frame) => !/[\uD800-\uDBFF]$/u.test(frame.text))).toBe(true)
  expect(
    Array.from(adversarialUtf16(source)).some((frame) => /[\uD800-\uDBFF]$/u.test(frame.text)),
  ).toBe(true)
})

test('negative control detects stale live output at a later checkpoint', () => {
  const observation = observeHast(renderRemark('One', true))
  expect(
    checkExpectations(observation, [{ tag: 'p', count: 1, texts: ['One small'] }]).length,
  ).toBeGreaterThan(0)
})

function compareSchedule(fixture: MarkdownCase, frames: Iterable<StreamFrame>): void {
  const raw = createRemarkReplay()
  const live = createRemarkReplay()
  let finalText = ''
  for (const frame of frames) {
    expect(raw.update(frame.text, false), `${fixture.id} raw prefix ${frame.offset}`).toEqual(
      renderRemark(frame.text, false),
    )
    expect(live.update(frame.text, true), `${fixture.id} live prefix ${frame.offset}`).toEqual(
      renderRemark(frame.text, true),
    )
    finalText = frame.text
  }
  expect(finalText).toBe(fixture.source)
  expect(live.update(finalText, false)).toEqual(renderRemark(fixture.source, false))
}
