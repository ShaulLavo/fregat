import type { ProviderSnapshot } from '@workspace/contracts'

import {
  isProviderAuthError,
  providerSignInTarget,
  type ProviderSignInTarget,
} from '@workspace/client-core/chat/providers/auth'
import type { ChatSession } from '@workspace/client-core/chat/types'

type ChatRuntimeAlertTone = 'error' | 'warning'

const ALERT_PRIORITY = { error: 0, warning: 1 } as const

type ChatRuntimeAlertPriority = (typeof ALERT_PRIORITY)[keyof typeof ALERT_PRIORITY]

export type ChatRuntimeAlert = {
  detail: string | null
  /**
   * Identity for dismissal, or `null` when the alert cannot be dismissed.
   * Carries the message, not just the id: a failure the user waved away must
   * stay away, while the *next*, different failure has to come back on its own.
   */
  dismissKey: string | null
  id: string
  priority: ChatRuntimeAlertPriority
  /** Set when the alert is an auth failure the user can clear by signing in. */
  signIn: ProviderSignInTarget | null
  title: string
  tone: ChatRuntimeAlertTone
}

/** Highest priority first; ties keep the order the producers emit them in. */
export function chatRuntimeAlerts({
  commandFailure,
  provider,
  providerError,
  providerLoading = false,
  session,
}: {
  commandFailure: string | null
  provider: ProviderSnapshot | undefined
  providerError: string | null
  providerLoading?: boolean
  session: ChatSession
}) {
  return [
    ...commandAlerts(commandFailure),
    ...providerAlerts(provider, providerError, providerLoading, session),
    ...(commandFailure ? [] : sessionErrorAlerts(session, provider)),
  ].sort((left, right) => left.priority - right.priority)
}

function commandAlerts(commandFailure: string | null): ChatRuntimeAlert[] {
  if (commandFailure) {
    return [
      alert({
        detail: commandFailure,
        // Dismissible: a send that failed minutes ago is history the moment the
        // user has read it, and nothing else ever clears it.
        dismissible: true,
        id: 'command:failure',
        title: 'Command failed',
        tone: 'error',
      }),
    ]
  }

  return []
}

function providerAlerts(
  provider: ProviderSnapshot | undefined,
  providerError: string | null,
  providerLoading: boolean,
  session: ChatSession,
): ChatRuntimeAlert[] {
  if (providerError) {
    return [
      alert({
        detail: providerError,
        dismissible: true,
        id: 'provider',
        title: 'Provider check failed',
        tone: 'error',
      }),
    ]
  }
  if (providerLoading && !provider) return []
  if (!provider) {
    return [
      alert({
        detail: `No snapshot for ${session.modelSelection.providerInstanceId}`,
        dismissible: true,
        id: 'provider',
        title: 'Provider unavailable',
        tone: 'warning',
      }),
    ]
  }
  if (!provider.installed || provider.availability === 'unavailable') {
    return [
      alert({
        detail: provider.message,
        id: 'provider',
        title: `${provider.displayLabel} provider unavailable`,
        tone: 'error',
      }),
    ]
  }
  if (provider.auth.status === 'unauthenticated') {
    return [
      alert({
        detail: provider.auth.label ?? provider.message,
        id: 'provider',
        signIn: providerSignInTarget(provider),
        title: `${provider.displayLabel} authentication required`,
        tone: 'error',
      }),
    ]
  }
  if (provider.status === 'warning') {
    return [
      alert({
        detail: provider.message ?? `${provider.displayLabel} provider has limited availability.`,
        dismissible: true,
        id: 'provider',
        title: `${provider.displayLabel} provider status`,
        tone: 'warning',
      }),
    ]
  }
  if (provider.status === 'error') {
    return [
      alert({
        detail: provider.message ?? `${provider.displayLabel} provider is unavailable.`,
        id: 'provider',
        signIn: authSignIn(provider.message, provider),
        title: `${provider.displayLabel} provider status`,
        tone: 'error',
      }),
    ]
  }

  return []
}

function sessionErrorAlerts(
  session: ChatSession,
  provider: ProviderSnapshot | undefined,
): ChatRuntimeAlert[] {
  const lastError = session.runtime?.lastError
  if (lastError && session.runtime?.status === 'interrupted') {
    return [
      alert({
        detail: lastError,
        dismissible: true,
        id: 'session:interrupted',
        title: 'Turn interrupted',
        tone: 'warning',
      }),
    ]
  }
  if (lastError) {
    return [
      alert({
        detail: lastError,
        // `lastError` is a persisted record of a past turn: it outlives the turn
        // that produced it, so the user has to be able to put it away.
        dismissible: true,
        id: 'session:error',
        signIn: authSignIn(lastError, provider),
        title: sessionErrorTitle(lastError, provider),
        tone: 'error',
      }),
    ]
  }
  if (session.latestTurn?.state === 'error') {
    return [alert({ dismissible: true, id: 'turn:error', title: 'Turn failed', tone: 'error' })]
  }

  return []
}

/**
 * A mid-turn credential failure is not a mystery "session error": name it, so the
 * title matches the Sign in button sitting next to it.
 */
function sessionErrorTitle(lastError: string, provider: ProviderSnapshot | undefined) {
  if (needsSignIn(lastError, provider)) return 'Sign-in required'

  return 'Session error'
}

/** Sign-in is only offered for messages that actually mean "sign in again". */
function authSignIn(message: string | null | undefined, provider: ProviderSnapshot | undefined) {
  if (!needsSignIn(message, provider)) return null

  return providerSignInTarget(provider)
}

/**
 * `lastError` is a persisted record of a past turn, so an old credential failure
 * outlives the credentials that caused it. Matching on the message alone kept
 * telling an already-signed-in user to sign in, with a button that opened a
 * dialog reporting their own account back at them. Current auth state decides.
 */
function needsSignIn(message: string | null | undefined, provider: ProviderSnapshot | undefined) {
  if (!isProviderAuthError(message)) return false
  if (provider?.auth.status === 'authenticated') return false

  return true
}

function alert({
  detail,
  dismissible = false,
  id,
  priority,
  signIn = null,
  title,
  tone,
}: {
  detail?: string | null
  dismissible?: boolean
  id: string
  priority?: ChatRuntimeAlertPriority
  signIn?: ProviderSignInTarget | null
  title: string
  tone: ChatRuntimeAlertTone
}): ChatRuntimeAlert {
  return {
    detail: detail ?? null,
    dismissKey: dismissible ? `${id}:${title}:${detail ?? ''}` : null,
    id,
    priority: priority ?? ALERT_PRIORITY[tone],
    signIn,
    title,
    tone,
  }
}
