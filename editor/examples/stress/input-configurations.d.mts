export type InputConsumerConfiguration = {
  readonly id: string
  readonly treeSitter: boolean
  readonly shiki: boolean
  readonly minimap: boolean
  readonly find: boolean
  readonly platform: boolean
  readonly language: 'typescript'
  readonly theme: 'github-dark'
}

export const inputConsumerIds: readonly string[]
export function inputConsumerConfiguration(id: string, fixture: string): InputConsumerConfiguration
export function assertConsumerReadiness(
  readiness: unknown,
  id: string,
  fixture: string,
  views: string,
  opened: unknown,
): void
