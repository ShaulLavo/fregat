export type InputConsumerConfiguration = {
  readonly id: string
  readonly analysis: boolean
  readonly treeSitter: boolean
  readonly shiki: boolean
  readonly minimap: boolean
  readonly find: boolean
  readonly platform: boolean
  readonly language: 'typescript'
  readonly theme: 'github-dark'
}

export const inputConsumerIds: readonly string[]
export const analysisLimitCodeUnits: number
export const minimapLimitCodeUnits: number
export function inputConsumerConfiguration(
  id: string,
  fixture: string,
  length: number,
): InputConsumerConfiguration
export function assertConsumerReadiness(
  readiness: unknown,
  id: string,
  fixture: string,
  length: number,
  views: string,
  scenario: string,
  opened: unknown,
): void
