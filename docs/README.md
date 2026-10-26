# Documentation

Start with the [README](../README.md) if you want to know what Fregat is. This index is for people who run it from source, change it, or want to know how it works.

## Run it and fix it

- [Development](development.md): run from a checkout, run the checks, build a release, pair a device, and the maintainer's owner-only setup.
- [Remote access](remote-access.md): reach the server from a phone or another computer.
- [Troubleshooting](troubleshooting.md): the failures a new checkout hits first.
- [Adopt package releases](releasing.md): update the inspected standalone dependencies.

## How it is built

- [Architecture](architecture.md): the big picture, one server per machine, how an agent turn flows.
- [Monorepo map](monorepo.md): every folder and what it owns.
- Decision records explain why the repository is shaped this way: [002, a typed router owns web navigation](adr/002-typed-router-owns-web-navigation.md) and [003, one server per machine](adr/003-one-server-per-machine-shared-by-clients.md).

## Internals and reference

See [subsystem documentation](internals.md) for files, sessions, editor, terminals, keyboard, UI, settings, and native clients.

## Standalone libraries

[Singapore](https://github.com/ShaulLavo/singapore), [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu), and [hotkeys](https://github.com/ShaulLavo/hotkeys) keep their docs in their own repositories. Fregat consumes their pinned release archives.

## Product site

The [landing page](https://fregat.shaulavo.dev/) is `apps/site`. The Fregat site runs on Cloudflare Workers. See [production product sites](../scripts/product-sites/README.md) for builds and publishing.
