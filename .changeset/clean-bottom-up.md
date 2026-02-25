---
"@cvr/stacked": patch
---

`clean` now removes merged branches bottom-up only, stopping at the first non-merged branch to prevent orphaned branches. Skipped merged branches are reported to the user.
