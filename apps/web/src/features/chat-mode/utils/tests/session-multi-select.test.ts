import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  sessionClickIntent,
  sessionIdRange,
  toggledSessionIds,
} from '@workspace/client-core/chat/rail/multi-select'
import { expect, test } from '../../../../../test/fixtures'

const sessionA = v.parse(sessionIdSchema, '0cecbcf1-b3a4-5425-826e-9780b43b7832')
const sessionB = v.parse(sessionIdSchema, 'ea35feb3-d322-5206-93b3-fad28939a07d')
const sessionC = v.parse(sessionIdSchema, '30886e00-b5c5-5564-8ba1-1431a307f361')
const order = [sessionA, sessionB, sessionC]

test('a plain click opens the row', () => {
  expect(sessionClickIntent({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('open')
})

test('the platform modifier toggles a single row', () => {
  expect(sessionClickIntent({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle')
  expect(sessionClickIntent({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('toggle')
})

test('shift wins over the toggle modifier so a range keeps growing', () => {
  expect(sessionClickIntent({ ctrlKey: false, metaKey: true, shiftKey: true })).toBe('extend')
})

test('toggling adds a row and takes it back out', () => {
  expect(toggledSessionIds([sessionA], sessionB)).toEqual([sessionA, sessionB])
  expect(toggledSessionIds([sessionA, sessionB], sessionA)).toEqual([sessionB])
})

test('a range spans the rows between the anchor and the target, either direction', () => {
  expect(sessionIdRange(order, sessionA, sessionC)).toEqual(order)
  expect(sessionIdRange(order, sessionC, sessionA)).toEqual(order)
})

test('a range with no anchor is just the row that was clicked', () => {
  expect(sessionIdRange(order, null, sessionB)).toEqual([sessionB])
})

test('an anchor that has been filtered out of the list spans nothing extra', () => {
  expect(sessionIdRange([sessionB, sessionC], sessionA, sessionC)).toEqual([sessionC])
})
