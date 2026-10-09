import { defineErrorCatalog } from 'evlog'

export const webErrors = defineErrorCatalog('web', {
  BOOTSTRAP_INVALID: {
    status: 500,
    message: 'Startup appearance could not be prepared',
    why: 'The selected appearance contains values the app cannot display.',
    fix: 'Choose a saved palette and reload the app.',
  },
  BOOTSTRAP_TEMPLATE_INVALID: {
    status: 500,
    message: 'The app document is incomplete',
    why: 'The installed document is missing a required startup element or contains duplicates.',
    fix: 'Build and install the web and server release together.',
  },
  BOOTSTRAP_ORIGIN_INVALID: {
    status: 403,
    message: 'Development page origin is unavailable',
    why: 'The development page must use an origin configured for this server.',
    fix: 'Use the configured development page URL.',
  },
  BOOTSTRAP_PROXY_INVALID: {
    status: 400,
    message: 'The app address could not be verified',
    why: 'The forwarding proxy must provide a valid address configured for this server.',
    fix: 'Check the proxy address and the server origin configuration, then reload the app.',
  },
  BOOTSTRAP_DOCUMENT_ORIGIN_INVALID: {
    status: 403,
    message: 'The app address is unavailable',
    why: 'The app document must load from an address configured for this server.',
    fix: 'Open the configured app URL.',
  },
  ROOT_MISSING: {
    status: 500,
    message: ({ root }: { root: string }) => `Web root is not a directory: ${root}`,
    why: 'WEB_ROOT names a release web directory the server would serve, and it does not exist.',
    fix: 'Point WEB_ROOT at a release `web/` directory, or unset it to run the API alone.',
  },
})
