import { expect, test } from '../../../../test/fixtures'
import { sameMachineAddress } from '@/hooks/utils/machine-form'

test('a saved machine at the same address is the same machine, whatever its label', () => {
  expect(
    sameMachineAddress(
      { kind: 'ssh', target: 'shaul-mac' },
      { kind: 'ssh', label: 'Mac', target: 'shaul-mac' },
    ),
  ).toBe(true)
  expect(
    sameMachineAddress({ kind: 'ssh', target: 'shaul-mac' }, { kind: 'ssh', target: 'other-mac' }),
  ).toBe(false)
  expect(
    sameMachineAddress(
      { kind: 'ssh', target: 'shaul-mac' },
      { kind: 'ssh', remotePort: 3400, target: 'shaul-mac' },
    ),
  ).toBe(false)
  expect(
    sameMachineAddress(
      { kind: 'origin', url: 'https://a.example' },
      { kind: 'ssh', target: 'a.example' },
    ),
  ).toBe(false)
})
