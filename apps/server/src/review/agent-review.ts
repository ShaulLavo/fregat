import {
  AGENT_REVIEW_OUTPUT_SCHEMA,
  type AgentReviewRequest,
  type AgentReviewResult,
  type AgentReviewTarget,
} from '@workspace/contracts'

import type { GitFileDiff, GitService } from '../git/service'
import { observeRequestOperation, operatorErrorSummary } from '../observability'
import type { OrchestrationCheckpointDiffQuery } from '../orchestration/checkpoint-diff-query'
import type { ProviderService } from '../provider/provider-service'
import type { ProviderTextGenerationInput } from '../provider/text-generation'
import { agentReviewErrors } from './structured-errors'
import { placeFindings, readReviewOutput } from './utils/findings'
import { checkoutReviewPrompt, patchReviewPrompt } from './utils/prompt'

/** Measured turn diffs reach 154 KB; a 20-commit branch reaches 1.27 MB and reads from the checkout. */
export const REVIEW_PATCH_BUDGET = 600_000

type ReviewRun = {
  readonly generation: Omit<ProviderTextGenerationInput, 'modelSelection' | 'purpose' | 'signal'>
  readonly patchLength: number | null
}

/** Asks a chosen provider and model to review a change and returns its findings on the lines. */
export class AgentReviewService {
  private readonly checkpointDiff: OrchestrationCheckpointDiffQuery
  private readonly git: GitService
  private readonly providers: ProviderService

  constructor(input: {
    checkpointDiff: OrchestrationCheckpointDiffQuery
    git: GitService
    providers: ProviderService
  }) {
    this.checkpointDiff = input.checkpointDiff
    this.git = input.git
    this.providers = input.providers
  }

  review(request: AgentReviewRequest, signal?: AbortSignal): Promise<AgentReviewResult> {
    let patchLength: number | null = null
    return observeRequestOperation(
      {
        area: 'review',
        operation: 'agent_review',
        providerInstanceId: request.reviewer.providerInstanceId,
        targetKind: request.target.kind,
      },
      async () => {
        const checkout = await this.git.repositoryRunner(request.rootPath)
        const run = await this.reviewRun(request, checkout.rootAbsolutePath)
        patchLength = run.patchLength
        const answer = await this.ask(request, run, signal)
        const output = readReviewOutput(answer.structured, answer.text)
        if (!output)
          throw agentReviewErrors.REVIEW_RESPONSE_UNREADABLE({
            internal: {
              structured: answer.structured !== undefined,
              textLength: answer.text.length,
            },
          })
        const placed = placeFindings(output, checkout)
        return {
          ...placed,
          verdict: output.overall_correctness,
          explanation: output.overall_explanation,
          reviewer: request.reviewer,
        }
      },
      (result) => ({
        findingCount: result.findings.length,
        model: request.reviewer.model,
        patchLength,
        unplacedCount: result.unplacedCount,
      }),
    )
  }

  private async ask(request: AgentReviewRequest, run: ReviewRun, signal?: AbortSignal) {
    try {
      return await this.providers.generateText({
        ...run.generation,
        modelSelection: request.reviewer,
        outputSchema: AGENT_REVIEW_OUTPUT_SCHEMA,
        purpose: 'review',
        signal,
      })
    } catch (error) {
      throw agentReviewErrors.REVIEW_PROVIDER_FAILED({
        providerInstanceId: request.reviewer.providerInstanceId,
        reason: operatorErrorSummary(error).message,
        cause: error instanceof Error ? error : undefined,
        internal: { model: request.reviewer.model, targetKind: request.target.kind },
      })
    }
  }

  /** A turn or the working tree goes in as a patch; a branch or commit is read in the checkout. */
  private async reviewRun(request: AgentReviewRequest, checkoutPath: string): Promise<ReviewRun> {
    const target = request.target
    if (target.kind === 'branch' || target.kind === 'commit')
      return {
        generation: {
          cwd: checkoutPath,
          interactionMode: 'plan',
          messageText: checkoutReviewPrompt(target),
        },
        patchLength: null,
      }
    const diffs = await this.targetDiffs(target, request.rootPath)
    const patch = diffs.map((diff) => diff.patch.trimEnd()).join('\n')
    if (!patch.trim())
      throw agentReviewErrors.REVIEW_NOTHING_TO_REVIEW({
        internal: { targetKind: target.kind, fileCount: diffs.length },
      })
    if (patch.length > REVIEW_PATCH_BUDGET)
      throw agentReviewErrors.REVIEW_PATCH_TOO_LARGE({
        size: patch.length,
        budget: REVIEW_PATCH_BUDGET,
        internal: { targetKind: target.kind, fileCount: diffs.length },
      })
    return {
      generation: { messageText: patchReviewPrompt(target, patch) },
      patchLength: patch.length,
    }
  }

  private async targetDiffs(
    target: Extract<AgentReviewTarget, { kind: 'turn' | 'uncommitted' }>,
    rootPath: string,
  ): Promise<readonly GitFileDiff[]> {
    if (target.kind === 'turn') {
      const turnCount = target.turnCount ?? this.checkpointDiff.latestTurnCount(target.sessionId)
      if (turnCount === 0) return []
      return this.checkpointDiff.turnDiff({
        sessionId: target.sessionId,
        fromTurnCount: turnCount - 1,
        toTurnCount: turnCount,
      })
    }
    const staged = await this.git.diff(rootPath, true)
    return staged.concat(await this.git.diff(rootPath, false))
  }
}
