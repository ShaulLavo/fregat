import * as v from 'valibot'

import { sessionIdSchema } from './chat-ids'
import { trimmedNonEmptyStringSchema } from './chat-model'
import { modelSelectionSchema } from './orchestration-runtime'

const lineNumberSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const turnCountSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

/** What an agent reviews: the working tree, a session's turns, a branch against its base, a commit. */
export const agentReviewTargetSchema = v.variant('kind', [
  v.object({ kind: v.literal('uncommitted') }),
  v.object({
    kind: v.literal('turn'),
    sessionId: sessionIdSchema,
    /** Which turn by checkpoint count; the latest when absent. */
    turnCount: v.optional(v.pipe(turnCountSchema, v.minValue(1))),
  }),
  v.object({ kind: v.literal('branch'), baseBranch: trimmedNonEmptyStringSchema }),
  v.object({
    kind: v.literal('commit'),
    sha: v.pipe(v.string(), v.regex(/^[0-9a-f]{4,64}$/i, 'Name the commit by its hash.')),
  }),
])

export const agentReviewRequestSchema = v.object({
  /** The checkout under review, as the git routes name it. */
  rootPath: v.string(),
  target: agentReviewTargetSchema,
  reviewer: modelSelectionSchema,
})

/** One finding, on the lines of one file under the reviewed checkout. */
export const agentReviewFindingSchema = v.object({
  title: v.string(),
  body: v.string(),
  /** 0 is the most urgent, as Codex ranks review findings. */
  priority: v.nullable(v.number()),
  confidence: v.nullable(v.number()),
  /** Relative to the checkout, like the git diff paths. */
  path: v.string(),
  startLine: lineNumberSchema,
  endLine: lineNumberSchema,
})

export const agentReviewResultSchema = v.object({
  findings: v.array(agentReviewFindingSchema),
  /** Findings that named a file outside the checkout or no line; kept out of the list. */
  unplacedCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  verdict: v.string(),
  explanation: v.string(),
  reviewer: modelSelectionSchema,
})

export type AgentReviewTarget = v.InferOutput<typeof agentReviewTargetSchema>
export type AgentReviewRequest = v.InferOutput<typeof agentReviewRequestSchema>
export type AgentReviewFinding = v.InferOutput<typeof agentReviewFindingSchema>
export type AgentReviewResult = v.InferOutput<typeof agentReviewResultSchema>

/**
 * The findings contract every reviewer answers in: Codex's `ReviewOutputEvent`, as a JSON schema
 * the provider enforces on its final message.
 */
export const AGENT_REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'overall_correctness', 'overall_explanation', 'overall_confidence_score'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body', 'confidence_score', 'priority', 'code_location'],
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          confidence_score: { type: 'number' },
          priority: { type: 'integer' },
          code_location: {
            type: 'object',
            additionalProperties: false,
            required: ['absolute_file_path', 'line_range'],
            properties: {
              absolute_file_path: { type: 'string' },
              line_range: {
                type: 'object',
                additionalProperties: false,
                required: ['start', 'end'],
                properties: { start: { type: 'integer' }, end: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    overall_correctness: { type: 'string' },
    overall_explanation: { type: 'string' },
    overall_confidence_score: { type: 'number' },
  },
} as const
