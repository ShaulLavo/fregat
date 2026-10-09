import { expect, test } from 'vitest'
import { parsePickRequest } from '../shell-bridge'

const origin = 'http://localhost:5173'
const documentId = '0f8fad5b-d9cb-469f-a165-70867728950e'
const request = (options: unknown) => ({ id: 3, documentId, method: 'pickEntry', origin, options })

test('parsePickRequest accepts a starting folder and rejects any other option', () => {
  expect(parsePickRequest(request({ startingPath: '/srv' }), origin)).toEqual({
    id: 3,
    documentId,
    options: { startingPath: '/srv' },
  })
  expect(parsePickRequest(request({}), origin)).toMatchObject({ options: {} })
  for (const options of [
    { mode: 'folder' },
    { accept: ['.ts'] },
    { multiple: true },
    { startingPath: 7 },
  ])
    expect(parsePickRequest(request(options), origin)).toBeUndefined()
})
