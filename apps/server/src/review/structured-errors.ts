import { defineErrorCatalog } from 'evlog'

export const agentReviewErrors = defineErrorCatalog('review', {
  REVIEW_NOTHING_TO_REVIEW: {
    status: 409,
    message: 'There are no changes to review.',
    why: 'The chosen changes hold no diff for the reviewer to read.',
    fix: 'Pick changes that differ from their base, then ask again.',
  },
  REVIEW_PATCH_TOO_LARGE: {
    status: 413,
    message: ({ size, budget }: { size: number; budget: number }) =>
      `The changes are ${Math.round(size / 1000)} KB, over the ${Math.round(budget / 1000)} KB a review reads.`,
    why: 'A review reads the whole patch in one turn, and a patch past the budget would be cut.',
    fix: 'Review a single turn, or commit part of the work and review the rest.',
  },
  REVIEW_PROVIDER_FAILED: {
    status: 502,
    message: ({ providerInstanceId, reason }: { providerInstanceId: string; reason: string }) =>
      `The review with ${providerInstanceId} failed: ${reason}`,
    why: 'The reviewer failed, stopped, or asked for approval during its isolated turn.',
    fix: 'Check the provider account and retry, or pick another reviewer.',
  },
  REVIEW_RESPONSE_UNREADABLE: {
    status: 502,
    message: 'The reviewer answered outside the findings format.',
    why: 'The final message did not match the review schema the reviewer was given.',
    fix: 'Retry the review, or pick another reviewer.',
  },
})
