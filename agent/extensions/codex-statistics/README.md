# Codex Statistics

Privacy-safe per-reply metrics for ChatGPT Codex subscription usage.

The extension activates only after Pi's `openai-codex` OAuth credential
successfully reads `https://chatgpt.com/backend-api/wham/usage`. Once active,
every agent reply is appended to
`~/.local/share/pi-codex-statistics/usage-YYYY-MM-DD.jsonl` (or
`%LOCALAPPDATA%\\pi-codex-statistics` on Windows).

Each reply contains its model and thinking level, per-turn token breakdowns,
timing, stop reasons, tool counts, and estimated cost. Schema version 2 also
records independent `quotaBefore` and `quotaAfter` snapshots for Codex replies.
Each snapshot contains only its fetch time, plan type, and the reported usage,
window length, and reset time for the five-hour and weekly windows. Existing
schema version 1 lines remain valid historical records.

Quota is account-wide. A before/after difference can include concurrent Codex
activity from another process, and should be calculated only when both snapshots
have the same `resetAt`. A missing or delayed usage response is recorded as
`null` and never prevents token metrics from being appended.

The ledger does not store prompts, responses, thinking text, tool
arguments/results, repository paths, OAuth tokens, response IDs, or raw account
IDs. `reasoning` is a subset of `output`, not an additional token count.
Monetary values are Pi's catalog estimates, not subscription charges.

This package has no UI behavior and independently fetches quota without importing
or depending on a footer extension. Quota display remains the responsibility of
the responsive footer.
