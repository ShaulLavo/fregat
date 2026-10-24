export async function loadFreeSans(): Promise<void> {
  const url = new URL('./FreeSans.ttf', import.meta.url).href
  const face = new FontFace('Geometry FreeSans', `url("${url}")`)
  document.fonts.add(await face.load())
  await document.fonts.load('13px "Geometry FreeSans"')
}
