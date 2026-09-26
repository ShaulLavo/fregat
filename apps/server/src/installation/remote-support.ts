// The `build` script bundles this as server/remote-support.js: a release's launch and stop
// scripts import it, since a release carries no contracts sources and no evlog.
export { createError } from 'evlog'
export { healthDescriptorSchema, ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
