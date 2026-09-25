import { describe, expect, it } from 'vitest'

import { parseFontconfigList } from '../installed'

describe('parseFontconfigList', () => {
  it('folds a variable file’s named instances into one ranged face', () => {
    const fonts = parseFontconfigList(
      [
        'Adwaita Sans\t200\t0\t\t/f/AdwaitaSans-Regular.ttf',
        'Adwaita Sans\t[0 210]\t0\t\t/f/AdwaitaSans-Regular.ttf',
        'Adwaita Sans\t80\t0\t\t/f/AdwaitaSans-Regular.ttf',
      ].join('\n'),
    )

    expect(fonts).toEqual([
      {
        family: 'Adwaita Sans',
        monospace: false,
        faces: [{ file: '/f/AdwaitaSans-Regular.ttf', style: 'normal', weight: '100 900' }],
      },
    ])
  })

  it('keeps the regular to bold weights and a regular italic of a static family', () => {
    const fonts = parseFontconfigList(
      [
        'Mono\t80\t0\t100\t/f/Mono-Regular.otf',
        'Mono\t200\t0\t100\t/f/Mono-Bold.otf',
        'Mono\t50\t0\t100\t/f/Mono-Light.otf',
        'Mono\t80\t100\t100\t/f/Mono-Italic.otf',
        'Mono\t200\t100\t100\t/f/Mono-BoldItalic.otf',
      ].join('\n'),
    )

    expect(fonts[0]?.monospace).toBe(true)
    expect(fonts[0]?.faces.map((face) => `${face.weight} ${face.style}`)).toEqual([
      '400 normal',
      '700 normal',
      '400 italic',
    ])
  })

  it('lists a collection-only family without servable faces, and skips hidden or unsafe names', () => {
    const fonts = parseFontconfigList(
      [
        'Noto Sans CJK JP\t80\t0\t\t/f/NotoSansCJK.ttc',
        '.LastResort\t80\t0\t\t/f/LastResort.otf',
        'Bad"Name\t80\t0\t\t/f/Bad.ttf',
      ].join('\n'),
    )

    expect(fonts).toEqual([{ family: 'Noto Sans CJK JP', monospace: false, faces: [] }])
  })
})
