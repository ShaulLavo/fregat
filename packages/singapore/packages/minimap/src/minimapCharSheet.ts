export const enum Constants {
  START_CH_CODE = 32,
  END_CH_CODE = 126,
  UNKNOWN_CODE = 65533,
  CHAR_COUNT = END_CH_CODE - START_CH_CODE + 2,
  SAMPLED_CHAR_HEIGHT = 16,
  SAMPLED_CHAR_WIDTH = 10,
  BASE_CHAR_HEIGHT = 2,
  BASE_CHAR_WIDTH = 1,
  RGBA_CHANNELS_CNT = 4,
  RGBA_SAMPLED_ROW_WIDTH = RGBA_CHANNELS_CNT * CHAR_COUNT * SAMPLED_CHAR_WIDTH,
}

export const allCharCodes: ReadonlyArray<number> = (() => {
  const values: number[] = []
  for (let index = Constants.START_CH_CODE; index <= Constants.END_CH_CODE; index += 1) {
    values.push(index)
  }

  values.push(Constants.UNKNOWN_CODE)
  return values
})()

export const getCharIndex = (chCode: number, fontScale: number): number => {
  const index = chCode - Constants.START_CH_CODE
  if (index >= 0 && index <= Constants.CHAR_COUNT) return index
  if (fontScale <= 2) return (index + Constants.CHAR_COUNT) % Constants.CHAR_COUNT
  return Constants.CHAR_COUNT - 1
}
