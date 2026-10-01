import { expect, test } from 'vitest'

import { laneRoot, memoryMax } from './lane-root'

test('places the lane directly under the Pi user home', () => {
  expect(laneRoot('/home/pi', 'fregat-lane')).toBe('/home/pi/fregat-lane')
})

test.each(['../etc', 'a/b', 'lane name', '$(reboot)', "x';rm", '/abs', '', '.hidden', 'UPPER'])(
  'refuses the lane name %j',
  (name) => {
    expect(() => laneRoot('/home/pi', name)).toThrow()
  },
)

test.each(['/root', '/home/pi/', '/home/pi/x', '/home/a b', '', '/tmp'])(
  'refuses the home %j',
  (home) => {
    expect(() => laneRoot(home, 'fregat-lane')).toThrow()
  },
)

test('accepts memory limits systemd reads and refuses shell text', () => {
  expect(memoryMax('3G')).toBe('3G')
  expect(memoryMax('2560M')).toBe('2560M')
  for (const value of ['3', '3G;reboot', 'infinity', '0G', '3 G'])
    expect(() => memoryMax(value)).toThrow()
})
