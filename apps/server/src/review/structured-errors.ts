import { defineErrorCatalog } from 'evlog'

export const agentReviewErrors = defineErrorCatalog('review', {
  REVIEW_NOTHING_TO_REVIEW: {
    status: 409,
    message: 'There are no changes to review.',
    why: 'The chosen changes are identical to their base.',
    fix: 'Pick changes that differ from their base, then ask again.',
  },
  REVIEW_PATCH_TOO_LARGE: {
    status: 413,
    message: ({ size, budget }: { size: number; budget: number }) =>
      `The changes are ${Math.round(size / 1000)} KB, over the ${Math.round(budget / 1000)} KB a review reads.`,
    why: 'A review reads all the changes at once, and changes past this size would be cut off.',
    fix: 'Review a single turn, or commit part of the work and review the rest.',
  },
  REVIEW_PROVIDER_FAILED: {
    status: 502,
    message: ({ providerInstanceId, reason }: { providerInstanceId: string; reason: string }) =>
      `The review with ${providerInstanceId} failed: ${reason}`,
    why: 'The reviewer failed, stopped, or asked for permission while reviewing.',
    fix: 'Check the provider account and retry, or pick another reviewer.',
  },
  REVIEW_RESPONSE_UNREADABLE: {
    status: 502,
    message: "The reviewer's answer could not be read.",
    why: 'Its answer was not in the findings format it was asked to use.',
    fix: 'Retry the review, or pick another reviewer.',
  },
})
