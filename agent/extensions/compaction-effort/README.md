# compaction-effort

Keeps pi's built-in compaction summaries at low reasoning effort while leaving
normal model responses at the session's selected level.

Pi 0.85.1 passes the session thinking level into compaction. Reasoning tokens
share the summary's fixed output cap, so high-effort models can repeatedly reach
the cap before finishing the checkpoint. This extension scopes the workaround
to the provider requests between `session_before_compact` and the matching
success or failure event.

It lowers explicit `medium`, `high`, `xhigh`, and `max` effort fields to `low`.
Requests already at `low`, `minimal`, or off are unchanged. The built-in
compaction implementation still owns message selection, split turns, file
tracking, retries, and usage accounting.

Upstream tracking:

- [Compaction at high effort reaches the output cap](https://github.com/earendil-works/pi/issues/9075)
- [Native configurable compaction thinking level](https://github.com/earendil-works/pi/pull/7602)

Remove this extension when pi supports native `compaction.thinkingLevel`.
