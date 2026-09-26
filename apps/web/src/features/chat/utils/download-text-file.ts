/** Saves text through the browser's download flow; nothing is written by the app. */
export function downloadTextFile(filename: string, text: string, mimeType: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = URL.createObjectURL(new Blob([text], { type: mimeType }))
  link.click()
  URL.revokeObjectURL(link.href)
}
