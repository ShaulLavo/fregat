import { act } from 'react'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'

import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { test, expect } from '../../../test/fixtures'
import { makeSettingsOwner } from '../../../test/factories/settings-owner'
import { renderTui } from '../../../test/render'

function FontSize({ owner, onRender }: { owner: SettingsOwner; onRender: () => void }) {
  onRender()
  const fontSize = useSettingValue(owner, 'editor.fontSize')
  return <text>{`font ${fontSize}`}</text>
}

async function submitAndSettle(owner: SettingsOwner, key: 'editor.fontSize' | 'editor.tabSize') {
  await act(async () => {
    const result = owner.submit('user', [{ kind: 'set', key, value: 17 }])
    if (result.kind === 'submitted') await result.settled
  })
}

test('a setting reader re-renders for its own key, not for another', async ({ client }) => {
  const owner = await makeSettingsOwner(client)
  let renders = 0
  const frame = await renderTui(<FontSize owner={owner} onRender={() => (renders += 1)} />, {
    width: 40,
    height: 4,
  })
  try {
    const initial = renders
    await submitAndSettle(owner, 'editor.tabSize')
    expect(renders).toBe(initial)

    await submitAndSettle(owner, 'editor.fontSize')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('font 17')
    expect(renders).toBeGreaterThan(initial)
  } finally {
    await frame.cleanup()
    owner.dispose()
  }
})
