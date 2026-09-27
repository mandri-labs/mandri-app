# Mandri frontend

- Write code and documentation in English.
- Never commit raw transcript captures or fixture backups. Generate them outside the repository and review sanitized fixtures before importing them.
- Run real harnesses and free model inference only in disposable Docker containers, with synthetic workspaces and selected credentials. Never send personal profiles or histories to free models.
- Preserve unrelated changes. Stage explicit paths, commit only the assigned changes and never push without authorization.
- Publish desktop GitHub releases as regular releases and mark the newest version as latest, even when the version contains a beta suffix. Never mark frontend releases as prereleases; version discovery depends on regular releases.
