export const MI_CODE_UNITS = 1_048_576

export function documentAnalysisAllowed(length: number, limitMiCodeUnits: number): boolean {
  return length <= limitMiCodeUnits * MI_CODE_UNITS
}

export function documentFeatureTier(
  length: number,
  analysisLimitMiCodeUnits: number,
  minimapLimitMiCodeUnits: number,
): number {
  return (
    (documentAnalysisAllowed(length, analysisLimitMiCodeUnits) ? 1 : 0) |
    (documentAnalysisAllowed(length, minimapLimitMiCodeUnits) ? 2 : 0)
  )
}
