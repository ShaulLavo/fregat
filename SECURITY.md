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

The browser terminal's clipboard behavior and shell connection are part of its integration policy.
Review the [terminal integration guide](ghostty-webgpu/docs/integration.md) when embedding it in another app.
