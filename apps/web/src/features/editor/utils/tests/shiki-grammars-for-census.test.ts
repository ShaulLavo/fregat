import { expect, test } from '../../../../../test/fixtures'
import { shikiGrammarsForCensus } from '@/features/editor/utils/shiki-grammars-for-census'

test('maps extensions, JSX variants and named files through the document grammar resolver', () => {
  expect(
    shikiGrammarsForCensus({
      '.ts': 10,
      '.tsx': 10,
      '.js': 10,
      '.jsx': 10,
      dockerfile: 10,
      makefile: 10,
      '.babelrc': 10,
      '.mdx': 10,
      '.unknown': 10,
    }),
  ).toEqual(['typescript', 'tsx', 'javascript', 'jsx', 'dockerfile', 'makefile', 'json'])
})

test('combines aliases before applying the inclusive 0.5% share of all counted files', () => {
  expect(
    shikiGrammarsForCensus({ '.yaml': 2, '.yml': 3, '.ts': 5, '.rb': 4, '.unknown': 986 }),
  ).toEqual(['yaml', 'typescript'])
})

test('a ready empty census has no background grammars', () => {
  expect(shikiGrammarsForCensus({})).toEqual([])
})
