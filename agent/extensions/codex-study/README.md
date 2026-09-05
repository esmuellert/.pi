# Codex Study

Pi extension for ChatGPT Codex subscription usage.

It activates only after Pi's `openai-codex` OAuth credential successfully reads
`https://chatgpt.com/backend-api/wham/usage`. Once active:

- the existing responsive footer shows the reported 5-hour and weekly windows
  as `reset countdown + six-cell bar + used percentage`, matching the local
  Claude Code status line, only while the selected provider is `openai-codex`;
- the cost suffix is `codex` for that provider and remains `sub` for other
  subscription providers;
- every agent reply is appended to
  `~/.local/share/pi-codex-study/usage-YYYY-MM-DD.jsonl` (or
  `%LOCALAPPDATA%\\pi-codex-study` on Windows).

The ledger stores numeric model/tool usage, model identifiers, timing, stop
reasons, and quota snapshots. It does not store prompts, responses, thinking
text, tool arguments/results, repository paths, OAuth tokens, response IDs, or
raw account IDs. `reasoning` is a subset of `output`, not an additional token
count. Monetary values are Pi's catalog estimates, not subscription charges.

The extension never owns the footer. It publishes verified quota snapshots over
Pi's extension event bus, and `responsive-footer` renders them alongside its
existing fields. OAuth credentials and the JSONL ledger remain outside the
repository.
