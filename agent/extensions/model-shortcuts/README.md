# Model shortcuts

All shortcuts select the model at **max** thinking for the current session.
They do not change the startup default.

| Shortcut | Provider | Model |
|---|---|---|
| Alt+1 | GitHub Copilot | `gpt-6-astra` |
| Alt+2 | GitHub Copilot | `gpt-6-sol` |
| Alt+3 | GitHub Copilot | `gpt-6-luna` |
| Alt+4 | OpenAI Codex | `gpt-6-astra` |
| Alt+5 | OpenAI Codex | `gpt-6-sol` |
| Alt+6 | OpenAI Codex | `gpt-6-luna` |
| Alt+7 | GitHub Copilot | `claude-opus-5.5` |

Run `/reload` in an existing pi session to load changed bindings. New sessions
load them automatically. A missing model or unavailable authentication produces
an error notification rather than silently selecting another model.
