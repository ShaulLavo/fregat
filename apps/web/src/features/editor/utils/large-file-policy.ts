import {
  documentAnalysisAllowed as workbenchDocumentAnalysisAllowed,
  documentFeatureTier as workbenchDocumentFeatureTier,
  MI_CODE_UNITS,
} from '@shaulavo/workbench-editor'

export { MI_CODE_UNITS }

export function documentAnalysisAllowed(length: number, limitMiCodeUnits: number): boolean {
  return workbenchDocumentAnalysisAllowed(length, limitMiCodeUnits * MI_CODE_UNITS)
}

export function documentFeatureTier(
  length: number,
  analysisLimitMiCodeUnits: number,
  minimapLimitMiCodeUnits: number,
): number {
  return workbenchDocumentFeatureTier(
    length,
    analysisLimitMiCodeUnits * MI_CODE_UNITS,
    minimapLimitMiCodeUnits * MI_CODE_UNITS,
  ).bitmask
}
