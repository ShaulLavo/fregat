import { defineErrorCatalog } from 'evlog'

export const webErrors = defineErrorCatalog('web', {
  ROOT_MISSING: {
    status: 500,
    message: ({ root }: { root: string }) => `Web root is not a directory: ${root}`,
    why: 'WEB_ROOT names a release web directory the server would serve, and it does not exist.',
    fix: 'Point WEB_ROOT at a release `web/` directory, or unset it to run the API alone.',
  },
})
