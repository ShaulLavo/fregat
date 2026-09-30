import { expect, test } from '../../../../test/fixtures'
import { diagramClassNames, isolateDiagramRecords } from '../utils/diagram-classes'

test('namespaces parsed class identities while retaining the default class and list separators', () => {
  expect(diagramClassNames('hidden,flex default  truncate')).toBe(
    'mermaid_user_hidden,mermaid_user_flex default  mermaid_user_truncate',
  )
})

test('isolates nested state class records without altering descriptions, identifiers or links', () => {
  const document = [
    { stmt: 'classDef', id: 'hidden', classes: 'fill:#abcdef' },
    { stmt: 'applyClass', id: 'Idle', styleClass: 'hidden' },
    {
      stmt: 'state',
      id: 'Outer',
      description: 'classDef hidden',
      doc: [
        { stmt: 'state', id: 'Idle', classes: ['hidden'], description: ':::hidden' },
        {
          stmt: 'relation',
          state1: { stmt: 'state', id: 'Idle', classes: ['hidden'] },
          state2: { stmt: 'state', id: 'Done' },
          description: 'classDef hidden',
        },
        {
          stmt: 'click',
          id: 'Idle',
          url: 'https://example.com/hidden',
          tooltip: 'classDef hidden',
        },
      ],
    },
  ]
  expect(isolateDiagramRecords(document)).toEqual([
    { stmt: 'classDef', id: 'mermaid_user_hidden', classes: 'fill:#abcdef' },
    { stmt: 'applyClass', id: 'Idle', styleClass: 'mermaid_user_hidden' },
    {
      stmt: 'state',
      id: 'Outer',
      description: 'classDef hidden',
      doc: [
        { stmt: 'state', id: 'Idle', classes: ['mermaid_user_hidden'], description: ':::hidden' },
        {
          stmt: 'relation',
          state1: { stmt: 'state', id: 'Idle', classes: ['mermaid_user_hidden'] },
          state2: { stmt: 'state', id: 'Done' },
          description: 'classDef hidden',
        },
        {
          stmt: 'click',
          id: 'Idle',
          url: 'https://example.com/hidden',
          tooltip: 'classDef hidden',
        },
      ],
    },
  ])
  expect(document[0]?.id).toBe('hidden')
})
