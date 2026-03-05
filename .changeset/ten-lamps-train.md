---
"@cvr/stacked": patch
---

Improve `detect` performance and configuration handling.

- Prevent `stacked detect` from hanging on very large repositories by limiting ancestry analysis to a bounded number of untracked branches.
- Add `STACKED_DETECT_MAX_BRANCHES` (default `200`) as an Effect `Config` value.
- Prefer most recently updated local branches during detection to keep bounded scans focused on active work.
- Migrate remaining env-based settings in `init` and UI color handling to Effect `Config` for consistency and testability.
- Make UI color helpers effectful and update command rendering paths accordingly.
