import { describe } from 'vitest'
import { expect, test as it } from '../../../../../test/fixtures'
import { DEFAULT_PROVIDER_INSTANCE_ID } from '@workspace/contracts'

import type { ChatSession } from '@workspace/client-core/chat/types'
import { chatRuntimeAlerts } from '@/features/chat/utils/runtime-state'
import { providerSnapshot as provider, session } from '../../../../../test/factories/chat'

describe('chat runtime state', () => {
  it('renders failures without duplicating pending request panels', () => {
    const alerts = chatRuntimeAlerts({
      commandFailure: 'Dispatch rejected',
      provider: provider({ auth: { status: 'unauthenticated' }, status: 'error' }),
      providerError: null,
      session: session({
        hasActionableProposedPlan: true,
        pendingApprovalCount: 1,
        pendingUserInputCount: 2,
      }),
    })

    expect(alerts.map((alert) => [alert.id, alert.title, alert.tone])).toEqual([
      ['command:failure', 'Command failed', 'error'],
      ['provider', 'Codex authentication required', 'error'],
    ])
  })

  it('offers sign-in on the authentication alert of a provider the app can sign in', () => {
    const [providerAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider({
        auth: { status: 'unauthenticated' },
        message: 'Claude Code is not signed in.',
        status: 'error',
        supportsSignIn: true,
      }),
      providerError: null,
      session: session(),
    })

    expect(providerAlert.signIn).toEqual({
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      providerLabel: 'Codex',
    })
    expect(providerAlert.detail).toBe('Claude Code is not signed in.')
  })

  it('offers sign-in on a mid-turn credential failure instead of a dead-end message', () => {
    const lastError = 'OAuth session expired and could not be refreshed'
    // Auth `unknown`, not `unauthenticated`: the CLI has not said either way, so
    // the only signal that credentials are gone is the turn that just failed.
    const [sessionAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider({ auth: { status: 'unknown' }, supportsSignIn: true }),
      providerError: null,
      session: sessionWithError(lastError),
    })

    expect(sessionAlert).toMatchObject({
      detail: lastError,
      id: 'session:error',
      signIn: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, providerLabel: 'Codex' },
      title: 'Sign-in required',
    })
  })

  /**
   * `lastError` is persisted, so a credential failure outlives the credentials
   * that caused it. Matching on the message alone told an already-signed-in user
   * to sign in, and the dialog then reported their own account back at them.
   */
  it('stops demanding sign-in once the provider is authenticated again', () => {
    const lastError = 'OAuth session expired and could not be refreshed'
    const [sessionAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider({
        auth: { email: 'someone@example.com', status: 'authenticated' },
        supportsSignIn: true,
      }),
      providerError: null,
      session: sessionWithError(lastError),
    })

    expect(sessionAlert).toMatchObject({
      detail: lastError,
      id: 'session:error',
      signIn: null,
      title: 'Session error',
    })
  })

  it('leaves non-auth session errors alone', () => {
    const [sessionAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider({ supportsSignIn: true }),
      providerError: null,
      session: sessionWithError('spawn claude ENOENT'),
    })

    expect(sessionAlert.title).toBe('Session error')
    expect(sessionAlert.signIn).toBe(null)
  })

  it('names a turn the server restart interrupted instead of calling it a session error', () => {
    const lastError = 'The server restarted while this provider operation was in progress.'
    const base = sessionWithError(lastError)
    const [sessionAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider(),
      providerError: null,
      session: { ...base, runtime: base.runtime && { ...base.runtime, status: 'interrupted' } },
    })

    expect(sessionAlert).toMatchObject({
      detail: lastError,
      id: 'session:interrupted',
      title: 'Turn interrupted',
      tone: 'warning',
    })
  })

  it('never offers sign-in for a provider the server cannot sign in', () => {
    const [sessionAlert] = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider({ auth: { status: 'unknown' } }),
      providerError: null,
      session: sessionWithError('Invalid API key · Please run /login'),
    })

    expect(sessionAlert.title).toBe('Sign-in required')
    expect(sessionAlert.signIn).toBe(null)
  })

  it('prefers the current command failure over the persisted session error', () => {
    const alerts = chatRuntimeAlerts({
      commandFailure: 'Dispatch rejected',
      provider: provider(),
      providerError: null,
      session: sessionWithError('Old session error'),
    })

    expect(alerts).toHaveLength(1)
    expect(alerts[0].detail).toBe('Dispatch rejected')
    expect(alerts[0].dismissKey).toBe('command:failure:Command failed:Dispatch rejected')
  })

  it('leaves pending requests to their actionable composer panels', () => {
    expect(
      chatRuntimeAlerts({
        commandFailure: null,
        provider: provider(),
        providerError: null,
        session: session({ pendingApprovalCount: 2, pendingUserInputCount: 1 }),
      }),
    ).toEqual([])
  })

  it('hides ready provider, running session, running turn, and available plan states', () => {
    const alerts = chatRuntimeAlerts({
      commandFailure: null,
      provider: provider(),
      providerError: null,
      session: session({ hasActionableProposedPlan: true }),
    })

    expect(alerts).toEqual([])
  })
})

function sessionWithError(lastError: string): ChatSession {
  const base = session()

  return { ...base, runtime: base.runtime ? { ...base.runtime, lastError } : null }
}
