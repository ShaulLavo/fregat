import { expect, test } from '../../../../test/fixtures'
import { isolateDiagramClasses } from '../utils/diagram-classes'

test('namespaces custom classes in flowchart, state and class diagrams', () => {
  const cases = [
    [
      'flowchart TD\n A[Start]:::hidden --> B[End]\n classDef hidden fill:#abc\n class A,B hidden;',
      'flowchart TD\n A[Start]:::mermaid_user_hidden --> B[End]\n classDef mermaid_user_hidden fill:#abc\n class A,B mermaid_user_hidden;',
    ],
    [
      'stateDiagram-v2\n state Idle\n classDef flex color:#fff\n class Idle flex',
      'stateDiagram-v2\n state Idle\n classDef mermaid_user_flex color:#fff\n class Idle mermaid_user_flex',
    ],
    [
      'classDiagram\n class Animal\n classDef truncate fill:#abc\n cssClass "Animal" truncate',
      'classDiagram\n class Animal\n classDef mermaid_user_truncate fill:#abc\n cssClass "Animal" mermaid_user_truncate',
    ],
  ]
  for (const [source, expected] of cases) expect(isolateDiagramClasses(source!)).toBe(expected)
})

test('preserves labels, comments, default styling and class declarations', () => {
  const source =
    'flowchart TD\n A[":::hidden classDef hidden"]:::hidden\n %% classDef hidden\n classDef hidden fill:#abc\n classDef default fill:#fff\n class B custom'
  expect(isolateDiagramClasses(source)).toBe(
    'flowchart TD\n A[":::hidden classDef hidden"]:::mermaid_user_hidden\n %% classDef hidden\n classDef mermaid_user_hidden fill:#abc\n classDef default fill:#fff\n class B mermaid_user_custom',
  )
  expect(isolateDiagramClasses('classDiagram\n class Animal\n Animal : +hidden()')).toBe(
    'classDiagram\n class Animal\n Animal : +hidden()',
  )
})

test('isolates attached classes even when they have no custom definition', () => {
  expect(isolateDiagramClasses('flowchart TD\n A:::hidden --> B\n class B flex')).toBe(
    'flowchart TD\n A:::mermaid_user_hidden --> B\n class B mermaid_user_flex',
  )
})

test('preserves class-like words inside unquoted node labels', () => {
  const source =
    'flowchart TD\n A[classDef hidden]:::hidden --> B{:::hidden}\n classDef hidden fill:#abc'
  expect(isolateDiagramClasses(source)).toBe(
    'flowchart TD\n A[classDef hidden]:::mermaid_user_hidden --> B{:::hidden}\n classDef mermaid_user_hidden fill:#abc',
  )
})
