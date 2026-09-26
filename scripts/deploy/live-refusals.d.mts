export type Refusal = {
  readonly timestamp: string
  readonly code: string
  readonly origin: string | null
}

type RefusalScope = { readonly release: string | undefined; readonly since: string }

export function refusedLogLines(lines: readonly string[], scope: RefusalScope): Refusal[]
export function refusalFailures(refusals: readonly Refusal[], release: string | undefined): string[]
export function readRefusals(directory: string | undefined, scope: RefusalScope): Promise<Refusal[]>
