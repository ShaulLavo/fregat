import { expect, test } from '../../../../../test/fixtures'
import { editorDragCollisionArgs } from '../../../../../test/factories/editor-drag'
import {
  containsPoint,
  dragMode,
  dragPoint,
  editorDragCollisions,
  editorDropData,
  splitEdgeAt,
} from '@/features/workbench/utils/editor-drag'

test.each([
  { point: { x: 105, y: 450 }, edge: 'left' },
  { point: { x: 1095, y: 450 }, edge: 'right' },
  { point: { x: 600, y: 205 }, edge: 'top' },
  { point: { x: 600, y: 795 }, edge: 'bottom' },
  { point: { x: 110, y: 205 }, edge: 'top' },
  { point: { x: 102, y: 215 }, edge: 'left' },
  { point: { x: 1098, y: 785 }, edge: 'right' },
  { point: { x: 1085, y: 798 }, edge: 'bottom' },
  { point: { x: 105, y: 205 }, edge: 'left' },
  { point: { x: 1095, y: 795 }, edge: 'right' },
])('offers the nearest $edge edge at $point with stable corner ties', ({ point, edge }) => {
  expect(splitEdgeAt({ left: 100, top: 200, width: 1000, height: 600 }, point)).toBe(edge)
})

test('keeps the center for joining groups and measures the band against the shorter dimension', () => {
  const bounds = { left: 20, top: 40, width: 1000, height: 400 }
  expect(splitEdgeAt(bounds, { x: 520, y: 240 })).toBeNull()
  expect(splitEdgeAt(bounds, { x: 100, y: 240 })).toBe('left')
  expect(splitEdgeAt(bounds, { x: 101, y: 240 })).toBeNull()
  expect(splitEdgeAt(bounds, { x: 520, y: 121 })).toBeNull()
})

test.each([
  { x: 19, y: 240 },
  { x: 1021, y: 240 },
  { x: 520, y: 39 },
  { x: 520, y: 441 },
])('never offers a split outside the editor bounds at %j', (point) => {
  const bounds = { left: 20, top: 40, width: 1000, height: 400 }
  expect(containsPoint(bounds, point)).toBe(false)
  expect(splitEdgeAt(bounds, point)).toBeNull()
})

test.each([
  { platform: 'linux', keys: { ctrlKey: true, altKey: false }, mode: 'copy' },
  { platform: 'windows', keys: { ctrlKey: true, altKey: false }, mode: 'copy' },
  { platform: 'mac', keys: { ctrlKey: true, altKey: false }, mode: 'move' },
  { platform: 'linux', keys: { ctrlKey: false, altKey: true }, mode: 'move' },
  { platform: 'windows', keys: { ctrlKey: false, altKey: true }, mode: 'move' },
  { platform: 'mac', keys: { ctrlKey: false, altKey: true }, mode: 'copy' },
  { platform: 'mac', keys: { ctrlKey: false, altKey: false }, mode: 'move' },
])('uses the platform copy modifier on $platform with $keys', ({ platform, keys, mode }) => {
  expect(dragMode(Object.assign(new Event('keydown'), keys), platform)).toBe(mode)
})

test('can return to move mode after the copy modifier is released', () => {
  expect(dragMode(Object.assign(new Event('keydown'), { ctrlKey: true }), 'linux')).toBe('copy')
  expect(dragMode(Object.assign(new Event('keyup'), { ctrlKey: false }), 'linux')).toBe('move')
  expect(dragMode(new Event('blur'), 'mac')).toBe('move')
})

test('retains raw pointer coordinates from collision detection instead of scroll-adjusted movement', () => {
  expect(dragPoint([{ id: 'tab', data: { pointerCoordinates: { x: 100, y: 240 } } }])).toEqual({
    x: 100,
    y: 240,
  })
  expect(dragPoint([{ id: 'tab', data: { value: 4 } }])).toBeNull()
  expect(dragPoint(null)).toBeNull()
})

test.each([
  undefined,
  null,
  42,
  'tab',
  [],
  {},
  { kind: 'group' },
  { kind: 'group', groupId: '' },
  { kind: 'strip', groupId: 12 },
  { kind: 'tab', groupId: 'group' },
  { kind: 'tab', groupId: 'group', tabId: '' },
  { kind: 'tab', groupId: 'group', tabId: 42 },
  { kind: 'unknown', groupId: 'group', tabId: 'tab' },
])('ignores malformed drag metadata %j', (value) => {
  expect(editorDropData(value)).toBeNull()
})

test('parses tab, strip, and group metadata without retaining unrelated fields', () => {
  expect(editorDropData({ kind: 'tab', groupId: 'group', tabId: 'tab', extra: 1 })).toEqual({
    kind: 'tab',
    groupId: 'group',
    tabId: 'tab',
  })
  expect(editorDropData({ kind: 'strip', groupId: 'group' })).toEqual({
    kind: 'strip',
    groupId: 'group',
  })
  expect(editorDropData({ kind: 'group', groupId: 'group' })).toEqual({
    kind: 'group',
    groupId: 'group',
  })
})

test('prefers the actual tab or strip under the pointer over its enclosing group', () => {
  const targets = [
    {
      id: 'group',
      data: { kind: 'group', groupId: 'source-group' },
      bounds: { left: 0, top: 0, width: 500, height: 400 },
    },
    {
      id: 'strip',
      data: { kind: 'strip', groupId: 'source-group' },
      bounds: { left: 0, top: 0, width: 500, height: 30 },
    },
    {
      id: 'tab',
      data: { kind: 'tab', groupId: 'source-group', tabId: 'tab' },
      bounds: { left: 0, top: 0, width: 80, height: 30 },
    },
  ]
  expect(editorDragCollisions(editorDragCollisionArgs(targets, { x: 40, y: 15 }))).toEqual([
    { id: 'tab', data: { pointerCoordinates: { x: 40, y: 15 } } },
  ])
  expect(editorDragCollisions(editorDragCollisionArgs(targets, { x: 300, y: 15 }))).toEqual([
    { id: 'strip', data: { pointerCoordinates: { x: 300, y: 15 } } },
  ])
  expect(editorDragCollisions(editorDragCollisionArgs(targets, { x: 300, y: 100 }))).toEqual([
    { id: 'group', data: { pointerCoordinates: { x: 300, y: 100 } } },
  ])
  expect(editorDragCollisions(editorDragCollisionArgs(targets, { x: 501, y: 100 }))).toEqual([])
})

test('keyboard collisions remain within the source strip even when another group is closer', () => {
  const targets = [
    {
      id: 'local',
      data: { kind: 'tab', groupId: 'source-group', tabId: 'local' },
      bounds: { left: 0, top: 0, width: 80, height: 30 },
    },
    {
      id: 'foreign',
      data: { kind: 'tab', groupId: 'other-group', tabId: 'foreign' },
      bounds: { left: 500, top: 0, width: 80, height: 30 },
    },
    {
      id: 'bad',
      data: { kind: 'tab', groupId: 'source-group' },
      bounds: { left: 500, top: 0, width: 80, height: 30 },
    },
  ]
  const args = editorDragCollisionArgs(targets, null, { left: 500, top: 0, width: 80, height: 30 })
  expect(editorDragCollisions(args).map((collision) => collision.id)).toEqual(['local'])
})

test('clips tab collisions to the containing strip before choosing a group', () => {
  const targets = [
    {
      id: 'left-strip',
      data: { kind: 'strip', groupId: 'left' },
      bounds: { left: 0, top: 0, width: 500, height: 30 },
    },
    {
      id: 'left-hidden-tab',
      data: { kind: 'tab', groupId: 'left', tabId: 'hidden' },
      bounds: { left: 480, top: 0, width: 150, height: 30 },
    },
    {
      id: 'right-strip',
      data: { kind: 'strip', groupId: 'right' },
      bounds: { left: 504, top: 0, width: 500, height: 30 },
    },
    {
      id: 'right-tab',
      data: { kind: 'tab', groupId: 'right', tabId: 'visible' },
      bounds: { left: 504, top: 0, width: 150, height: 30 },
    },
  ]
  expect(
    editorDragCollisions(editorDragCollisionArgs(targets, { x: 520, y: 15 })).map((hit) => hit.id),
  ).toEqual(['right-tab'])
  expect(editorDragCollisions(editorDragCollisionArgs(targets, { x: 501, y: 15 }))).toEqual([])
  expect(
    editorDragCollisions(editorDragCollisionArgs(targets.slice(0, 2), { x: 520, y: 15 })),
  ).toEqual([])
})
