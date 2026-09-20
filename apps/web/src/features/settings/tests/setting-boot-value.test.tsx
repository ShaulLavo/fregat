import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { renderHook, waitFor } from '@testing-library/react'
import { useSettingValue } from '@/hooks/use-setting-value'
import { readSettingBootValue, writeBootMirror } from '@/lib/settings-boot-mirror'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { afterEach } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { AppProviders, createTestQueryClient } from '../../../../test/render'

afterEach(() => localStorage.clear())

test('disabled guides use the mirror on first render, then confirmed settings take over', async ({
  client,
}) => {
  expect(client).toBeDefined()
  writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'editor.guides.indentation': false })
  const queryClient = createTestQueryClient()
  const renderedValues: boolean[] = []
  const hook = renderHook(
    () => {
      const enabled = useSettingValue('editor.guides.indentation')
      renderedValues.push(enabled)
      return enabled
    },
    {
      wrapper: ({ children }) => (
        <AppProviders command={false} queryClient={queryClient}>
          {children}
        </AppProviders>
      ),
    },
  )

  expect(queryClient.getQueryData(settingsKeys.document())).toBeUndefined()
  expect(renderedValues[0]).toBe(false)
  expect(hook.result.current).toBe(false)

  await waitFor(() => expect(hook.result.current).toBe(true))
  expect(queryClient.getQueryData(settingsKeys.document())).toBeDefined()
  hook.unmount()
  queryClient.clear()
})

test('single-key boot reads validate mirrored values and ignore unmirrored values', () => {
  localStorage.setItem(
    'platform.settings-boot-mirror.v1',
    JSON.stringify({
      'editor.guides.indentation': 'invalid',
      'environments.machines': { untrusted: {} },
    }),
  )

  expect(readSettingBootValue('editor.guides.indentation')).toBe(true)
  expect(readSettingBootValue('environments.machines')).toBe(
    DEFAULT_SETTING_VALUES['environments.machines'],
  )
})
