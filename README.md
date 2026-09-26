# Mandri desktop

Mandri is a local control plane for AI agent sessions. This repository contains
the React client and its Tauri desktop application.

## Development

Install the dependencies with `npm ci`. Run `npm run dev` for the browser client
or `npm run tauri:dev` for the desktop client. The daemon defaults to
`http://127.0.0.1:8787`.

Run `npm run check` for TypeScript, lint, unit tests and browser regressions.
Run `npm run tauri:build` to build a desktop installer with the native toolchain.

Real daemon and agent integration tests live in the separate `mandri-e2e`
repository. Test fixtures in this repository contain synthetic or sanitized data.

## License

Sustainable Use License 1.0. Internal business, personal and non-commercial use
are permitted. Redistribution must be free of charge and for non-commercial
purposes. See `LICENSE` for the full terms. For other uses, contact labs@mandri.io.
