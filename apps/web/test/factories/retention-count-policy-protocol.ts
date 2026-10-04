export type RetentionFixture = {
  readonly id: string
  readonly provider: 'tree-sitter' | 'shiki'
  readonly language: 'typescript' | 'markdown'
  readonly sourceUnits: number
}

export type RetentionRun = {
  readonly sourceHead: string
  readonly cycles: number
  readonly fixtures: readonly RetentionFixture[]
  readonly protocol: typeof RETENTION_COUNT_PROTOCOL
}

export const RETENTION_COUNT_PROTOCOL = {
  version: 1,
  registeredSetting: 'editor.inactiveAnalysisEntryLimit',
  expectedInactiveEntryLimit: 2,
  negativeControlLimit: Number.MAX_SAFE_INTEGER,
  explicitTrimLimit: 0,
  workingDocumentCount: 5,
  successfulCycleMarker: 'protocol-cycle-complete',
  arms: [
    'idle-inspector-calibration',
    'selected-provider-baseline',
    'baseline-active-b',
    'actual-two-editor-views',
    'actual-editor-synchronous-warm-attachment',
    'active-two-compatible-views',
    'warm-two-family-release',
    'synchronous-warm-attachment',
    'configuration-history-pressure',
    'active-range-history-diagnostic',
    'cycle-end',
    'continuously-active-range-history',
    'pending-before-worker-fence',
    'pending-work-settled-after-release',
    'failed-real-worker-active-entry',
    'failed-real-worker-inactive-entry',
    'retained-growth-negative',
    'explicit-zero-trim',
    'environment-release-b-survives',
    'final-document-owner-release',
    'terminal-workers',
  ],
  missingAcceptance: [
    'preparation-pins',
    'obsolete-and-abandoned-intent-classification',
    'shared-speculative-caller-cancellation',
    'late-reply-after-reclamation',
    'configuration-replacement-rejects-stale-readiness',
    'two-disjoint-active-view-fold-matrix',
    'terminal-inspector-in-flight-rejection',
    'plain-editor',
    'qualified-source-stack-and-current-CI',
    'hardware-Chrome-input',
    'Mac-WebKit-Safari',
  ],
}

export function parseRetentionFixtures(input: unknown): readonly RetentionFixture[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new TypeError('A fixture array is required')
  if (input.length > 8) throw new TypeError('A bounded run accepts at most eight fixtures')
  const fixtures = input.map(parseFixture)
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new TypeError('Fixture identifiers must be unique')
  return fixtures
}

function parseFixture(input: unknown): RetentionFixture {
  if (typeof input !== 'object' || input === null) throw new TypeError('Invalid fixture object')
  if (!('id' in input) || typeof input.id !== 'string' || !/^[\w-]+$/.test(input.id))
    throw new TypeError('Invalid fixture identifier')
  if (!('provider' in input) || (input.provider !== 'tree-sitter' && input.provider !== 'shiki'))
    throw new TypeError('Invalid fixture provider')
  if (!('language' in input) || (input.language !== 'typescript' && input.language !== 'markdown'))
    throw new TypeError('Invalid fixture language')
  if (!('sourceUnits' in input) || typeof input.sourceUnits !== 'number')
    throw new TypeError('Missing fixture source units')
  if (
    !Number.isSafeInteger(input.sourceUnits) ||
    input.sourceUnits < 4096 ||
    input.sourceUnits > 1_048_576
  )
    throw new TypeError('Fixture source units must be an integer between 4096 and 1048576')
  return {
    id: input.id,
    provider: input.provider,
    language: input.language,
    sourceUnits: input.sourceUnits,
  }
}

export function retentionFixtureText(fixture: RetentionFixture): string {
  const line =
    fixture.language === 'typescript'
      ? 'export const retained = { answer: 42 };\n'
      : '# Retained document\n\n**bold** and `code`\n\n'
  return line.repeat(Math.ceil(fixture.sourceUnits / line.length)).slice(0, fixture.sourceUnits)
}

export function inactiveBound(inactiveEntries: number, limit: number) {
  return { inactiveEntries, limit, passes: inactiveEntries <= limit }
}
