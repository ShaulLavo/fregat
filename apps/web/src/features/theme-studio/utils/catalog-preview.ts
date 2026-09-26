// Cloudinary's fetch mode pulls the GitHub file once, caches it, and serves a card-sized WebP/AVIF.
export function catalogPreviewUrl(source: string, cloud: string) {
  if (!cloud) return source
  return `https://res.cloudinary.com/${cloud}/image/fetch/c_fill,w_480,h_270,f_auto,q_auto/${encodeURIComponent(source)}`
}
