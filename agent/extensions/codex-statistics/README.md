# Codex Statistics

Privacy-safe per-reply metrics for ChatGPT Codex subscription usage.

The extension activates only after Pi's `openai-codex` OAuth credential
successfully reads `https://chatgpt.com/backend-api/wham/usage`. Once active,
every agent reply is appended to
`~/.local/share/pi-codex-statistics/usage-YYYY-MM-DD.jsonl` (or
`%LOCALAPPDATA%\\pi-codex-statistics` on Windows).

Each reply contains its model and thinking level, per-turn token breakdowns,
timing, stop reasons, tool counts, and estimated cost. The quota request is used
only to verify that the Codex subscription login is valid; quota display belongs
to the independent responsive footer.

The ledger does not store prompts, responses, thinking text, tool
arguments/results, repository paths, OAuth tokens, response IDs, or raw account
IDs. `reasoning` is a subset of `output`, not an additional token count.
Monetary values are Pi's catalog estimates, not subscription charges.

This package has no UI behavior and no dependency on a footer extension.
