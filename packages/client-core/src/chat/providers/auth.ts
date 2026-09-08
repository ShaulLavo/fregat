import type {
  ProviderAuth,
  ProviderInstanceId,
  ProviderLoginAttempt,
  ProviderSignInMethod,
  ProviderSnapshot,
} from '@workspace/contracts'

/**
 * What the sign-in surface is doing right now. `waiting` is the load-bearing one:
 * the CLI has opened a browser tab and nothing will happen until the user finishes
 * there, so the UI has to say that instead of showing a bare spinner.
 */
export type ProviderSignInPhase =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** Which provider a sign-in surface acts on, and what to call it in copy. */
export type ProviderSignInTarget = {
  readonly providerInstanceId: ProviderInstanceId
  readonly providerLabel: string
}

export type ProviderAuthMethodCopy = {
  /** Terminal fallback for when the CLI cannot open a browser. */
  command: string
  description: string
  label: string
}

export type ProviderAuthTone = 'destructive' | 'success' | 'warning'

export type ProviderAuthStatusCopy = {
  detail: string | null
  title: string
  tone: ProviderAuthTone
}

export type ProviderSignInCopy = {
  description: string
  title: string
}

/** Subscription first: it is the default and the primary action in the dialog. */
export const PROVIDER_AUTH_METHODS = [
  'subscription',
  'console',
  'sso',
] as const satisfies readonly ProviderSignInMethod[]

export const DEFAULT_PROVIDER_AUTH_METHOD: ProviderSignInMethod = 'subscription'

const METHOD_COPY: Record<ProviderSignInMethod, ProviderAuthMethodCopy> = {
  console: {
    command: 'claude auth login --console',
    description: 'Use an Anthropic Console account. Turns are billed as API usage.',
    label: 'Anthropic Console',
  },
  sso: {
    command: 'claude auth login --sso',
    description: 'Use the identity provider your organization signs in through.',
    label: 'Single sign-on',
  },
  subscription: {
    command: 'claude auth login --claudeai',
    description: 'Use your Claude Pro or Max plan. No API usage billing.',
    label: 'Claude subscription',
  },
}

// `apiProvider` and `subscriptionType` come straight off the CLI account payload.
// Anything not listed here is shown verbatim rather than dropped.
const AUTH_TYPE_LABELS: Record<string, string> = {
  bedrock: 'Amazon Bedrock',
  enterprise: 'Enterprise plan',
  firstParty: 'Anthropic API',
  max: 'Max plan',
  pro: 'Pro plan',
  team: 'Team plan',
  vertex: 'Google Vertex AI',
}

// Needles are matched against lowercased text. Every entry has to be unambiguous
// on its own: a bare `401` is not here because it collides with ordinary numbers
// in tool output, and `authentication` is not here because it also appears in
// success text ("authentication succeeded").
const AUTH_ERROR_NEEDLES = [
  'oauth session expired',
  'oauth token',
  'not authenticated',
  'unauthenticated',
  'authentication required',
  'authentication_error',
  'invalid api key',
  'invalid_api_key',
  'unauthorized',
  'session expired',
  'token expired',
  'expired credentials',
  'no credentials',
  'credentials not found',
  'claude login',
  'claude auth login',
  '/login',
  'please log in',
  'please sign in',
]

export function providerAuthMethodCopy(method: ProviderSignInMethod): ProviderAuthMethodCopy {
  return METHOD_COPY[method]
}

export function providerAuthMethodLabel(method: ProviderSignInMethod): string {
  return METHOD_COPY[method].label
}

export function providerSignInCommand(method: ProviderSignInMethod): string {
  return METHOD_COPY[method].command
}

/**
 * Does this message mean "sign in again"? Provider snapshots, CLI stderr and
 * mid-turn stream errors all phrase it differently, so callers hand us whatever
 * text they have and we decide whether to offer sign-in.
 */
export function isProviderAuthError(message: string | null | undefined): boolean {
  if (!message) return false

  const text = message.toLowerCase()

  return AUTH_ERROR_NEEDLES.some((needle) => text.includes(needle))
}

export function providerAuthTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null

  return AUTH_TYPE_LABELS[type] ?? type
}

/** `you@example.com · Max plan`, or as much of it as the CLI reported. */
export function providerAccountLabel(auth: ProviderAuth | null | undefined): string | null {
  if (!auth) return null

  const plan = auth.label ?? providerAuthTypeLabel(auth.type)
  const parts = [auth.email, plan].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return null

  return parts.join(' · ')
}

export function providerAuthStatusCopy(
  auth: ProviderAuth | null | undefined,
): ProviderAuthStatusCopy {
  if (!auth || auth.status === 'unknown') {
    return {
      detail: 'The CLI did not report a sign-in state.',
      title: 'Sign-in state unknown',
      tone: 'warning',
    }
  }
  if (auth.status === 'unauthenticated') {
    return {
      detail: 'Sign in before sending a turn with this provider.',
      title: 'Not signed in',
      tone: 'destructive',
    }
  }

  return { detail: providerAccountLabel(auth), title: 'Signed in', tone: 'success' }
}

export function providerSignInPhase({
  attempt,
  startFailed,
  startPending,
}: {
  attempt: ProviderLoginAttempt | null
  startFailed: boolean
  startPending: boolean
}): ProviderSignInPhase {
  if (startPending) return 'starting'
  if (startFailed) return 'failed'
  if (!attempt) return 'idle'
  if (attempt.state === 'pending') return 'waiting'
  if (attempt.state === 'succeeded') return 'succeeded'
  if (attempt.state === 'cancelled') return 'cancelled'

  return 'failed'
}

/** The provider is signed out, so none of its models can run a turn. */
export function providerRequiresSignIn(provider: ProviderSnapshot | null | undefined): boolean {
  return provider?.auth.status === 'unauthenticated'
}

/** The server can start sign-in for this provider from inside the app. */
export function providerSupportsSignIn(provider: ProviderSnapshot | null | undefined): boolean {
  return provider?.supportsSignIn === true
}

/**
 * The sign-in the app can offer for this provider, or `null` when it has none —
 * a provider whose CLI we cannot drive gets text, never a dead button.
 */
export function providerSignInTarget(
  provider: ProviderSnapshot | null | undefined,
): ProviderSignInTarget | null {
  if (!provider) return null
  if (!providerSupportsSignIn(provider)) return null

  return {
    providerInstanceId: provider.providerInstanceId,
    providerLabel: provider.displayLabel,
  }
}

export function isProviderSignInBusy(phase: ProviderSignInPhase): boolean {
  return phase === 'starting' || phase === 'waiting'
}

export function providerSignInPhaseCopy({
  method,
  phase,
}: {
  method: ProviderSignInMethod
  phase: ProviderSignInPhase
}): ProviderSignInCopy {
  const label = providerAuthMethodLabel(method)

  if (phase === 'starting') {
    return {
      description: `Starting the ${label} flow in the Claude CLI.`,
      title: 'Opening your browser',
    }
  }
  if (phase === 'waiting') {
    return {
      description: `A browser tab was opened to finish ${label} sign-in. Complete it there — this dialog updates on its own once the CLI reports back.`,
      title: 'Waiting for your browser',
    }
  }
  if (phase === 'succeeded') {
    return {
      description: 'The Claude CLI is signed in. This dialog closes on its own.',
      title: 'Signed in',
    }
  }
  if (phase === 'failed') {
    return {
      description:
        'The Claude CLI could not finish sign-in. Try again, or run the command yourself in a terminal.',
      title: 'Sign-in failed',
    }
  }
  if (phase === 'cancelled') {
    return {
      description: 'The sign-in attempt was stopped. Nothing changed.',
      title: 'Sign-in cancelled',
    }
  }

  return {
    description: 'Sign-in runs through the Claude CLI, which opens a browser tab to finish.',
    title: 'Choose how to sign in',
  }
}
