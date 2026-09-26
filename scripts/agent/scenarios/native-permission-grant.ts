import { deepStrictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

/** A Codex permission request answered "for this session" replies with the profile it asked for. */
export const nativePermissionGrant = isolatedNativeScenario({
  name: 'native-permission-grant',
  description:
    'A native Codex permission request is allowed for the session; the reply carries the requested network profile with session scope under the original request id, and the turn finishes.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    await sendPrompt(page, 'Install the dependency.')
    const approval = selectors.genericApproval(page)
    await approval.waitFor({ timeout: 30_000 })
    await step('permission-request')
    await approval.getByRole('button', { name: 'Allow for this session', exact: true }).click()
    await approval.waitFor({ state: 'hidden', timeout: 30_000 })
    await selectors
      .chatMessages(page)
      .getByText('PERMISSION_GRANT_VERIFIED', { exact: true })
      .waitFor({ timeout: 30_000 })
    deepStrictEqual(
      (await nativeLog(root)).filter((entry) => entry.event === 'permission-response'),
      [
        {
          event: 'permission-response',
          id: 992,
          result: { permissions: { network: { enabled: true } }, scope: 'session' },
        },
      ],
    )
    await step('exact-native-grant')
  },
})
