const installResults: readonly string[] = [
  'kGetWebAppInstallInfoFailed',
  'kPreviouslyUninstalled',
  'kWebContentsDestroyed',
  'kWriteDataFailed',
  'kUserInstallDeclined',
  'kNotValidManifestForWebApp',
  'kIntentToPlayStore',
  'kWebAppDisabled',
  'kInstallURLRedirected',
  'kInstallURLLoadFailed',
  'kExpectedAppIdCheckFailed',
  'kInstallURLLoadTimeOut',
  'kFailedPlaceholderUninstall',
  'kNotInstallable',
  'kApkWebAppInstallFailed',
  'kCancelledOnWebAppProviderShuttingDown',
  'kWebAppProviderNotReady',
  'kInstallTaskDestroyed',
  'kUpdateTaskFailed',
  'kAppNotInRegistrarAfterCommit',
  'kHaltedBySyncUninstall',
  'kInstallURLInvalid',
  'kIconDownloadingFailed',
  'kCancelledDueToMainFrameNavigation',
  'kNoValidIconsInManifest',
  'kNoCustomManifestId',
  'kManifestIdMismatch',
  'kNoValidMigrationSource',
  'kInvalidManifestId',
  'kInstallAlreadyInProgress',
]

export function protocolErrorFacts(error: Record<string, unknown>) {
  const code = error.code
  const message = typeof error.message === 'string' ? error.message : ''
  const result = message.startsWith('Failed to install ') ? message.split(': ').at(-1) : ''
  return {
    protocolCode: typeof code === 'number' && Number.isFinite(code) ? code : null,
    protocolReason: protocolReason(message),
    // Keep Chromium's fixed result enum; browser messages can contain private URLs and page data.
    installResult: result && installResults.includes(result) ? result : null,
  }
}

function protocolReason(message: string) {
  if (message.startsWith('Unknown web-app manifest id ')) return 'unknown-app'
  if (message === 'Webapps are not available in current profile.') return 'pwa-unavailable'
  if (message.startsWith("Couldn't fetch install info for ")) return 'install-info-unavailable'
  if (message.startsWith('Expected manifest id ')) return 'manifest-mismatch'
  if (message.startsWith('Invalid manifest id: ')) return 'invalid-manifest-id'
  if (message.startsWith('Failed to install ')) return 'install-failed'
  return 'other'
}
