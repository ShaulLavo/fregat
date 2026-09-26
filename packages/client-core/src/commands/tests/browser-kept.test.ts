import { describe, expect, it } from 'vitest'
import { browserEngine, browserKeeps } from '../browser-kept'

describe('browserKeeps', () => {
  it('keeps Chrome tab chords in a tab and none in an installed window', () => {
    expect(browserKeeps('Mod+W', 'chromium', false, 'linux')).toBe(true)
    expect(browserKeeps('Mod+W', 'chromium', true, 'linux')).toBe(false)
    expect(browserKeeps('Mod+Shift+T', 'chromium', false, 'linux')).toBe(true)
    expect(browserKeeps('Mod+P', 'chromium', false, 'linux')).toBe(false)
  })

  it('reads only the first stroke of a chord', () => {
    expect(browserKeeps('Mod+W Mod+S', 'chromium', false, 'linux')).toBe(true)
    expect(browserKeeps('Mod+K Mod+W', 'chromium', false, 'linux')).toBe(false)
  })

  it('matches Control apart from Cmd on macOS', () => {
    expect(browserKeeps('Control+Tab', 'webkit-mac', false, 'mac')).toBe(true)
    expect(browserKeeps('Mod+Tab', 'webkit-mac', false, 'mac')).toBe(false)
    expect(browserKeeps('Mod+,', 'webkit-ipad', true, 'mac')).toBe(true)
  })
})

describe('browserEngine', () => {
  it('names the engine from the user agent', () => {
    const chrome =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0'
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

    expect(browserEngine(chrome, 0)).toBe('chromium')
    expect(browserEngine(firefox, 0)).toBe('gecko')
    expect(browserEngine(safari, 0)).toBe('webkit-mac')
    expect(browserEngine(safari, 5)).toBe('webkit-ipad')
  })
})
