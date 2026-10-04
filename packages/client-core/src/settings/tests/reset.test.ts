import { expect, test } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { resetSettingOperations } from '../operations'
import { settingRowIds } from '@workspace/contracts/settings/presentation'

test('resetting the models row resets every key it owns', () => {
  expect(
    resetSettingOperations(
      'models.hidden',
      { values: DEFAULT_SETTING_VALUES, layers: [] },
      'user',
      'dark',
      settingRowIds('models.hidden'),
    ),
  ).toEqual([{ kind: 'reset', keys: ['models.hidden', 'models.order', 'models.favorites'] }])
})
