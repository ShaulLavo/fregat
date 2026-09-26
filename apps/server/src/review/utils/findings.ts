import path from 'node:path'

import type { AgentReviewFinding } from '@workspace/contracts'
import * as v from 'valibot'

const reviewOutputSchema = v.object({
  findings: v.array(
    v.object({
      title: v.string(),
      body: v.string(),
      confidence_score: v.number(),
      priority: v.number(),
      code_location: v.object({
        absolute_file_path: v.string(),
        line_range: v.object({ start: v.number(), end: v.number() }),
      }),
    }),
  ),
  overall_correctness: v.string(),
  overall_explanation: v.string(),
})

export type ReviewOutput = v.InferOutput<typeof reviewOutputSchema>

/** The parsed answer, or the JSON in the text when the provider only returns text (Codex). */
export function readReviewOutput(structured: unknown, text: string): ReviewOutput | null {
  const parsed = v.safeParse(reviewOutputSchema, structured ?? parseJson(text))
  return parsed.success ? parsed.output : null
}

function parseJson(text: string): unknown {
  const body = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

type Checkout = {
  /** The checkout as the machine names it. */
  readonly rootAbsolutePath: string
  /** The checkout as the git routes name it; diff paths start with it. */
  readonly rootPath: string
}

/** Findings on files inside the checkout, with paths the git diffs use; the rest are counted. */
export function placeFindings(output: ReviewOutput, checkout: Checkout) {
  const findings: AgentReviewFinding[] = []
  for (const finding of output.findings) {
    const placed = placeFinding(finding, checkout)
    if (placed) findings.push(placed)
  }
  return { findings, unplacedCount: output.findings.length - findings.length }
}

function placeFinding(
  finding: ReviewOutput['findings'][number],
  checkout: Checkout,
): AgentReviewFinding | null {
  const relative = repositoryRelative(finding.code_location.absolute_file_path, checkout)
  if (!relative) return null
  const start = Math.trunc(finding.code_location.line_range.start)
  const end = Math.max(start, Math.trunc(finding.code_location.line_range.end))
  if (start < 1) return null
  return {
    title: finding.title,
    body: finding.body,
    priority: finding.priority,
    confidence: finding.confidence_score,
    path: checkout.rootPath ? path.posix.join(checkout.rootPath, relative) : relative,
    startLine: start,
    endLine: end,
  }
}

function repositoryRelative(filePath: string, checkout: Checkout) {
  const cleaned = filePath.trim().replace(/^[ab]\//, '')
  const relative = path.isAbsolute(cleaned)
    ? path.relative(checkout.rootAbsolutePath, cleaned)
    : path.posix.normalize(cleaned)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}
