# Fixture import

Real inference belongs to [mandri-e2e](../../../mandri-e2e/README.md). Its `built_image`, `free_model_relay` and disposable daemon fixtures provide the maintained harness versions, credential separation and restricted network. Use synthetic workspaces only. Never mount personal harness state or pass provider credentials directly to a harness or daemon.

The legacy frontend Compose/Docker recipe has been removed. It passed real provider keys to the daemon and did not restrict harness egress. `capture.mjs` now stops immediately; it performs no network requests. An automatic frontend fixture export must be implemented inside the E2E fixture lifecycle before this entry point can be restored. Do not recreate an independent capture container or bypass the relay.

Existing sanitized source fixtures remain under `tests/fixtures`. Write new recordings and reports under `../artifacts/runs` relative to the frontend repository, then review them for personal paths, messages and credentials. Import only individual files that have been reviewed:

```powershell
node scripts/capture-fixtures/import-reviewed.mjs --reviewed ../artifacts/runs/remediation-2026-09-11/frontend/capture-staging/claude/chat.json
npm test -- tests/unit/fixtures-replay.test.ts
```

The importer validates the fixture envelope and rejects common credential/path leaks. It writes only the declared known harness/scenario target. Review its Git diff before committing.
