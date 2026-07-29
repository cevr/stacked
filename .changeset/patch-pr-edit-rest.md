---
"@cvr/stacked": patch
---

Fix `submit` failing with a GitHub GraphQL error: `gh pr edit` queries the deprecated Projects (classic) `projectCards` field, which GitHub now rejects. PR base/title/body updates now go through the REST endpoint (`gh api -X PATCH`) instead.
