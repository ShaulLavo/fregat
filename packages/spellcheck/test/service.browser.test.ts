import { afterEach, describe, expect, it } from 'vitest'
import { SpellcheckService } from '../src/service'

let service: SpellcheckService | null = null

afterEach(() => {
  service?.dispose()
  service = null
})

describe('SpellcheckService with its bundled worker', () => {
  it('loads the dictionary and answers checks and suggestions', async () => {
    service = new SpellcheckService()
    expect(await service.check(['the', 'befor', 'behaviour', 'worktree'])).toEqual(['befor'])
    expect(await service.suggest('befor')).toContain('before')
  })

  it('applies accepted words, including ones set before the worker started', async () => {
    service = new SpellcheckService()
    service.setAcceptedWords(['fregat'])
    expect(await service.check(['fregat', 'befor'])).toEqual(['befor'])
    service.setAcceptedWords([])
    expect(await service.check(['fregat'])).toEqual(['fregat'])
  })

  it('rejects pending requests when disposed', async () => {
    service = new SpellcheckService()
    const pending = service.check(['befor'])
    service.dispose()
    await expect(pending).rejects.toThrow('disposed')
  })
})
