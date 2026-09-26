import { agentReviewRequestSchema, agentReviewResultSchema } from '@workspace/contracts'
import { Elysia } from 'elysia'

import type { AgentReviewService } from './agent-review'

export function agentReviewRoutes(reviews: AgentReviewService) {
  return new Elysia({ name: 'agent-review-routes' }).post(
    '/agent-review',
    ({ body, request }) => reviews.review(body, request.signal),
    { body: agentReviewRequestSchema, response: agentReviewResultSchema },
  )
}
