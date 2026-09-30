import { describe, expect, it } from 'vitest'
import type { ShikiWorkerRequest, ShikiWorkerResponse } from '../../src/shiki/workerTypes'

describe('Shiki worker message types', () => {
  it('accepts request and response payload shapes used by the worker client', () => {
    const request: ShikiWorkerRequest = {
      id: 1,
      payload: {
        type: 'open',
        documentId: 'doc',
        runtimeSessionId: 'runtime-doc',
        text: 'const value = 1;',
        lang: 'typescript',
        theme: 'github-dark',
        languageRegistrations: [
          {
            name: 'typescript',
            patterns: [],
            repository: {},
            scopeName: 'source.ts',
          },
        ],
        themeRegistration: { name: 'github-dark' },
        themeRegistrations: [],
      },
    }
    const response: ShikiWorkerResponse = {
      id: request.id,
      ok: true,
      result: {
        documentId: 'doc',
        tokensPacked: {
          starts: new Uint32Array(),
          ends: new Uint32Array(),
          styleIds: new Uint32Array(),
          styles: [],
          monotonicEnd: true,
          nonOverlapping: true,
          sortedByStart: true,
        },
      },
    }

    expect(request.payload.type).toBe('open')
    if (request.payload.type === 'open') {
      expect(response.result?.documentId).toBe(request.payload.documentId)
    }
  })
})
