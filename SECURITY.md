# Security policy

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/ShaulLavo/fregat/security/advisories/new) for Fregat, Singapore, ghostty-webgpu, and hotkeys.
The standalone package repositories are read-only mirrors. Their security reports belong here too.

Include the affected product, version or commit, reproduction steps, impact, and any proposed fix.
Use a minimal example with synthetic data. Remove credentials and personal data from logs and attachments.
Keep exploit details in the private report while we investigate and prepare a fix.

## Supported code

Security fixes target the current `main` branch. Older releases have no separate security-maintenance commitment.
The current npm releases of Singapore and ghostty-webgpu lag behind this repository. Check the affected source commit when reporting a problem.

## Deployment and trust

Fregat runs a server with access to your files and agent tools. Pair only devices and machines you trust.
Keep remote access private, configure HTTPS, and review the [filesystem boundaries](docs/filesystem-boundaries.md).
Pairing grants access to your machine's workspace. Treat access to the server as access to that work.

Know these defaults before you expose a server:

- The file server starts at the system root, subject to operating-system permissions. `FS_WORKSPACE_ROOT` restricts it, and it is not an operating-system sandbox.
- New agent sessions start in `full-access` mode (`chat.defaultRuntimeMode`). A restricted file API does not confine an agent's shell commands.
- A browser on the machine itself needs no pairing. Any other browser pairs first. A reverse proxy must preserve the public `Host` header, or always add a forwarding header such as `X-Forwarded-For`. A proxy that rewrites every request to a loopback host and strips every forwarding header makes remote traffic look local. See [reverse proxy device trust](docs/development.md#reverse-proxy-device-trust).

The browser terminal's clipboard behavior and shell connection are part of its integration policy.
Review the [terminal integration guide](packages/ghostty-webgpu/docs/integration.md) when embedding it in another app.
