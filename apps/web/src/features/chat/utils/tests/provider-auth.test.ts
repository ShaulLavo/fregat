import type {
  ProviderInstanceId,
  ProviderLoginAttempt,
  ProviderLoginState,
} from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'

import {
  isProviderAuthError,
  isProviderSignInBusy,
  providerAccountLabel,
  providerAuthMethodCopy,
  providerAuthMethodLabel,
  providerAuthStatusCopy,
  providerRequiresSignIn,
  providerSignInCommand,
  providerSignInPhase,
  providerSignInPhaseCopy,
  providerSignInTarget,
  providerSupportsSignIn,
  PROVIDER_AUTH_METHODS,
} from '@workspace/client-core/chat/providers/auth'
import { providerSnapshot } from '../../../../../test/factories/chat'

function attempt(state: ProviderLoginState, message?: string): ProviderLoginAttempt {
  return {
    attemptId: 'attempt-1',
    completedAt: state === 'pending' ? null : '2026-08-09T00:00:01.000Z',
    method: 'subscription',
    outputTail: [],
    providerInstanceId: 'claude' as ProviderInstanceId,
    startedAt: '2026-08-09T00:00:00.000Z',
    state,
    ...(message ? { message } : {}),
  }
}

test('the subscription method comes first so the dialog can make it primary', () => {
  expect(PROVIDER_AUTH_METHODS[0]).toBe('subscription')
  expect([...PROVIDER_AUTH_METHODS]).toEqual(['subscription', 'console', 'sso'])
})

test('every method has a label, a one-line description and a CLI command', () => {
  expect(PROVIDER_AUTH_METHODS.map(providerAuthMethodLabel)).toEqual([
    'Claude subscription',
    'Anthropic Console',
    'Single sign-on',
  ])
  expect(PROVIDER_AUTH_METHODS.map(providerSignInCommand)).toEqual([
    'claude auth login --claudeai',
    'claude auth login --console',
    'claude auth login --sso',
  ])

  for (const method of PROVIDER_AUTH_METHODS) {
    const copy = providerAuthMethodCopy(method)
    expect(copy.description.length).toBeGreaterThan(0)
    // One line: the dialog renders it under the label, never wrapped to a paragraph.
    expect(copy.description).not.toContain('\n')
  }
})

test('the explicit method flag is always present so the CLI never prompts', () => {
  for (const method of PROVIDER_AUTH_METHODS) {
    expect(providerSignInCommand(method)).toMatch(/^claude auth login --[a-z]+$/)
  }
})

test('real provider auth failures are detected', () => {
  // Verbatim strings the CLI and the SDK stream have produced.
  expect(isProviderAuthError('OAuth session expired and could not be refreshed')).toBe(true)
  expect(isProviderAuthError('not authenticated')).toBe(true)
  expect(
    isProviderAuthError('Claude Code is not authenticated. Run `claude login` and try again.'),
  ).toBe(true)
  expect(isProviderAuthError('Invalid API key · Please run /login')).toBe(true)
  expect(isProviderAuthError('401 Unauthorized')).toBe(true)
  expect(isProviderAuthError('authentication_error: invalid x-api-key')).toBe(true)
})

test('auth detection ignores case and empty input', () => {
  expect(isProviderAuthError('OAUTH SESSION EXPIRED')).toBe(true)
  expect(isProviderAuthError('')).toBe(false)
  expect(isProviderAuthError(null)).toBe(false)
  expect(isProviderAuthError(undefined)).toBe(false)
})

test('non-auth failures do not offer sign-in', () => {
  expect(isProviderAuthError('spawn claude ENOENT')).toBe(false)
  expect(isProviderAuthError('Your credit balance is too low')).toBe(false)
  expect(isProviderAuthError('Request timed out after 120000ms')).toBe(false)
  // "authenticated" alone must not trip the check — it appears in success text.
  expect(isProviderAuthError('Successfully authenticated as you@example.com')).toBe(false)
  // A bare number is not a 401.
  expect(isProviderAuthError('Read 4012 lines from src/index.ts')).toBe(false)
})

test('status copy maps each auth state to a tone the theme has a token for', () => {
  expect(providerAuthStatusCopy({ status: 'authenticated', email: 'you@example.com' })).toEqual({
    detail: 'you@example.com',
    title: 'Signed in',
    tone: 'success',
  })
  expect(providerAuthStatusCopy({ status: 'unauthenticated' }).tone).toBe('destructive')
  expect(providerAuthStatusCopy({ status: 'unknown' }).tone).toBe('warning')
  // A missing snapshot reads as unknown, not as signed out.
  expect(providerAuthStatusCopy(null).tone).toBe('warning')
  expect(providerAuthStatusCopy(undefined).title).toBe('Sign-in state unknown')
})

test('the account label uses whatever the CLI reported', () => {
  expect(
    providerAccountLabel({ status: 'authenticated', email: 'you@example.com', type: 'max' }),
  ).toBe('you@example.com · Max plan')
  expect(providerAccountLabel({ status: 'authenticated', type: 'bedrock' })).toBe('Amazon Bedrock')
  // An unmapped type is shown verbatim rather than dropped.
  expect(providerAccountLabel({ status: 'authenticated', type: 'someNewPlan' })).toBe('someNewPlan')
  // An explicit label wins over the derived type label.
  expect(
    providerAccountLabel({ status: 'authenticated', label: 'Work account', type: 'pro' }),
  ).toBe('Work account')
  expect(providerAccountLabel({ status: 'unauthenticated' })).toBe(null)
  expect(providerAccountLabel(null)).toBe(null)
})

test('the phase follows the attempt, with the start mutation taking priority', () => {
  expect(providerSignInPhase({ attempt: null, startFailed: false, startPending: false })).toBe(
    'idle',
  )
  expect(providerSignInPhase({ attempt: null, startFailed: false, startPending: true })).toBe(
    'starting',
  )
  expect(providerSignInPhase({ attempt: null, startFailed: true, startPending: false })).toBe(
    'failed',
  )
  // A start that is retrying outranks the stale attempt still in the cache.
  expect(
    providerSignInPhase({ attempt: attempt('failed'), startFailed: false, startPending: true }),
  ).toBe('starting')
})

test('every attempt state maps to a phase', () => {
  const phaseOf = (state: ProviderLoginState) =>
    providerSignInPhase({ attempt: attempt(state), startFailed: false, startPending: false })

  expect(phaseOf('pending')).toBe('waiting')
  expect(phaseOf('succeeded')).toBe('succeeded')
  expect(phaseOf('failed')).toBe('failed')
  expect(phaseOf('cancelled')).toBe('cancelled')
})

test('only the two in-flight phases count as busy', () => {
  expect(isProviderSignInBusy('starting')).toBe(true)
  expect(isProviderSignInBusy('waiting')).toBe(true)
  expect(isProviderSignInBusy('idle')).toBe(false)
  expect(isProviderSignInBusy('succeeded')).toBe(false)
  expect(isProviderSignInBusy('failed')).toBe(false)
  expect(isProviderSignInBusy('cancelled')).toBe(false)
})

test('a signed-out provider needs sign-in, whatever else it reports', () => {
  expect(providerRequiresSignIn(providerSnapshot({ auth: { status: 'unauthenticated' } }))).toBe(
    true,
  )
  expect(providerRequiresSignIn(providerSnapshot())).toBe(false)
  // Unknown is not signed out: the CLI simply did not say.
  expect(providerRequiresSignIn(providerSnapshot({ auth: { status: 'unknown' } }))).toBe(false)
  expect(providerRequiresSignIn(undefined)).toBe(false)
})

test('sign-in is only offered for providers the server can drive', () => {
  const signedOut = providerSnapshot({ auth: { status: 'unauthenticated' }, supportsSignIn: true })

  expect(providerSupportsSignIn(signedOut)).toBe(true)
  expect(providerSignInTarget(signedOut)).toEqual({
    providerInstanceId: 'codex',
    providerLabel: 'Codex',
  })
  // A provider with no in-app flow gets text, never a button that would 400.
  expect(providerSupportsSignIn(providerSnapshot())).toBe(false)
  expect(providerSignInTarget(providerSnapshot())).toBe(null)
  expect(providerSignInTarget(undefined)).toBe(null)
})

test('the waiting copy names the browser tab and the chosen method', () => {
  const waiting = providerSignInPhaseCopy({ method: 'sso', phase: 'waiting' })

  expect(waiting.title).toBe('Waiting for your browser')
  expect(waiting.description).toContain('browser tab')
  expect(waiting.description).toContain('Single sign-on')
})

test('every phase has its own title so no state shows a bare spinner', () => {
  const phases = ['idle', 'starting', 'waiting', 'succeeded', 'failed', 'cancelled'] as const
  const titles = phases.map(
    (phase) => providerSignInPhaseCopy({ method: 'subscription', phase }).title,
  )

  expect(new Set(titles).size).toBe(phases.length)
  for (const phase of phases) {
    const copy = providerSignInPhaseCopy({ method: 'subscription', phase })
    expect(copy.description.length).toBeGreaterThan(0)
  }
})
