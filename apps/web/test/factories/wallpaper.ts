export function wallpaperPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCV84sZrnWH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZaxDqH4oKFDNUOxZcghBGOdjhwe1wcyvD5qctHqZwAAAABJRU5ErkJggg==',
    'base64',
  )
}

// Different bytes, so a different content-addressed asset than `wallpaperPng`.
export function secondWallpaperPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
    'base64',
  )
}
