import { defineErrorCatalog } from 'evlog'

export const gitCommitMessageErrors = defineErrorCatalog('git', {
  COMMIT_MESSAGE_CANCELLED: {
    status: 499,
    message: 'Commit message generation was cancelled.',
    why: 'The request was stopped before the AI finished writing the message.',
    fix: 'Request another message when you are ready.',
  },
  COMMIT_MESSAGE_DIFF_EMPTY: {
    status: 409,
    message: 'There are no staged or working changes to describe.',
    why: 'No file has staged or unstaged changes to describe.',
    fix: 'Change or stage a file, then request a commit message again.',
  },
  COMMIT_MESSAGE_PROVIDER_FAILED: {
    status: 502,
    message: ({ providerInstanceId, reason }: { providerInstanceId: string; reason?: string }) =>
      reason
        ? `Could not generate a commit message with ${providerInstanceId}: ${reason}`
        : `Could not generate a commit message with ${providerInstanceId}.`,
    why: 'The AI provider failed, stopped, or asked for permission while writing the message.',
    fix: 'Check the provider account and retry, or enable another provider in settings.',
  },
  COMMIT_MESSAGE_PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'No AI provider is ready to write a commit message.',
    why: 'Every AI provider is turned off, unavailable, signed out, or has no model to use.',
    fix: 'Sign in to ChatGPT or enable another provider with an available model, then retry.',
  },
  COMMIT_MESSAGE_RESPONSE_EMPTY: {
    status: 502,
    message: 'The AI provider returned an empty commit message.',
    why: 'The AI provider finished without writing any text.',
    fix: 'Retry the request or select another provider.',
  },
})
