#!/usr/bin/env node
// Real inference is owned by mandri-e2e's isolated daemon and trusted relay.
throw new Error(
  "The legacy frontend fixture recorder is disabled. Use the mandri-e2e isolated image, free-model relay and disposable daemon; review staged fixtures before importing them with import-reviewed.mjs.",
);
