import { expect, test } from 'vitest'
import { answerPickRequest } from '../native-window'
import { parsePickRequest } from '../shell-bridge'

const origin = 'http://localhost:5173'
const documentId = '0f8fad5b-d9cb-469f-a165-70867728950e'
const request = (options: unknown) => ({ id: 3, documentId, method: 'pickEntry', origin, options })

test('parsePickRequest keeps a starting folder and refuses unknown option keys', () => {
  expect(parsePickRequest(request({ startingPath: '/srv' }), origin)).toEqual({
    id: 3,
    documentId,
    options: { startingPath: '/srv' },
  })
  for (const options of [{ mode: 'folder' }, { accept: ['.ts'] }, { multiple: true }])
    expect(parsePickRequest(request(options), origin)).toEqual({
      id: 3,
      documentId,
      refused: 'options',
    })
  expect(parsePickRequest(request({ startingPath: 7 }), origin)).toMatchObject({
    refused: 'options',
  })
  expect(parsePickRequest(request('folder'), origin)).toMatchObject({ refused: 'options' })
})

test('parsePickRequest ignores requests with no caller to answer', () => {
  expect(parsePickRequest({ ...request({}), id: 'x' }, origin)).toBeUndefined()
  expect(parsePickRequest({ ...request({}), documentId: 'nope' }, origin)).toBeUndefined()
  expect(
    parsePickRequest({ ...request({}), origin: 'https://evil.example' }, origin),
  ).toBeUndefined()
})

test('a refused request gets an error reply without opening a chooser', async () => {
  const replies: unknown[] = []
  let picks = 0
  answerPickRequest(
    request({ mode: 'folder' }),
    origin,
    async () => {
      picks++
      return []
    },
    (response) => replies.push(response),
  )
  await expect.poll(() => replies).toHaveLength(1)
  expect(picks).toBe(0)
  expect(replies[0]).toEqual({
    id: 3,
    documentId,
    error: {
      message: 'The folder chooser request is not valid.',
      code: 'desktop.webview.PICKER_REFUSED',
      why: 'The desktop app could not read the folder chooser request this window sent.',
      fix: 'Reload the window, then open the folder again.',
    },
  })
})

test('a valid request replies with the chosen folder', async () => {
  const replies: unknown[] = []
  answerPickRequest(
    request({ startingPath: '/srv' }),
    origin,
    async (options) => [`${options.startingPath}/project`],
    (response) => replies.push(response),
  )
  await expect.poll(() => replies).toEqual([{ id: 3, documentId, paths: ['/srv/project'] }])
})
