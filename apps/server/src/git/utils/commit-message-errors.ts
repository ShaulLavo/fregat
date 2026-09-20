import { defineErrorCatalog } from 'evlog'

export const gitCommitMessageErrors = defineErrorCatalog('git', {
  COMMIT_MESSAGE_CANCELLED: {
    status: 499,
    message: 'Commit message generation was cancelled.',
    why: 'The client ended the request while the provider turn was still running.',
    fix: 'Request another message when you are ready.',
  },
  COMMIT_MESSAGE_DIFF_EMPTY: {
    status: 409,
    message: 'There are no staged or working changes to describe.',
    why: 'Neither the index nor the working tree contains a diff the provider can summarize.',
    fix: 'Change or stage a file, then request a commit message again.',
  },
  COMMIT_MESSAGE_PROVIDER_FAILED: {
    status: 502,
    message: ({ providerInstanceId, reason }: { providerInstanceId: string; reason?: string }) =>
      reason
        ? `Could not generate a commit message with ${providerInstanceId}: ${reason}`
        : `Could not generate a commit message with ${providerInstanceId}.`,
    why: 'The selected provider failed, stopped, or requested interaction during the isolated generation turn.',
    fix: 'Check the provider account and retry, or enable another provider in settings.',
  },
  COMMIT_MESSAGE_PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'No ready AI provider has an advertised model for commit message generation.',
    why: 'Every configured provider is disabled, unavailable, signed out, or has no usable advertised model.',
    fix: 'Sign in to ChatGPT or enable another provider with an available model, then retry.',
  },
  COMMIT_MESSAGE_RESPONSE_EMPTY: {
    status: 502,
    message: 'The AI provider returned an empty commit message.',
    why: 'The provider turn completed without any assistant text to place in the commit input.',
    fix: 'Retry the request or select another provider.',
  },
})
