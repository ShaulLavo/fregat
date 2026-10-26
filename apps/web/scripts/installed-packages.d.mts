export type InstalledPackageFingerprint = {
  name: string
  version: string
  sha256: string
}

export function installedPackageFingerprint(
  name: string,
  consumer?: URL | string,
): InstalledPackageFingerprint

export function installedDependencyFingerprint(
  prefix: string,
  consumer?: URL | string,
): { packages: InstalledPackageFingerprint[]; sha256: string }
