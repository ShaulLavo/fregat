import { generateFixture, type FixtureId } from './fixtures.ts'

/** Keep the E003 text and seed, adding fixed scopes with offscreen endings. */
export function generateFallbackFixture(id: FixtureId, seed: number): string {
  return generateFixture(id, seed)
    .split('\n')
    .map((line, row) => indentLine(line, row))
    .join('\n')
}

function indentLine(line: string, row: number): string {
  if (row % 5000 === 0) return line
  if (row % 5000 === 1) return '  // #region section'
  if (row % 5000 === 4999) return '  // #endregion'
  if (row % 500 === 2) return `  ${line}`
  return `    ${line}`
}
