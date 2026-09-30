export type PackageManifest = {
  name: string
  version?: string
  private?: boolean
  packageManager?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  repository?: { type: string; url: string; directory: string }
  workspaces?: {
    packages: string[]
    catalog: Record<string, string>
    catalogs?: Record<string, Record<string, string>>
  }
}
export type RootManifest = PackageManifest & {
  workspaces: NonNullable<PackageManifest['workspaces']>
}
export function readManifest(source: string): PackageManifest {
  return JSON.parse(source)
}
