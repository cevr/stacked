---
"@cvr/stacked": patch
---

Migrate stack metadata to an explicit v2 parent-link format with automatic v1 upgrade, reroot surviving stacks when lower branches disappear, and speed up `detect` by switching from pairwise ancestor checks to first-parent history walks.
