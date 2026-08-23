# rename

`/rename` — name this session, or have a name written for it.

```
/rename 重构工具块的摘要     set it
/rename                      ask a model, using the conversation as it stands
```

## Why not `/name`

pi has `/name <name>`. It is handled inline in `interactive-mode.js`, before the
dispatcher looks a command up among the extensions, so the word is taken.

What pi has no version of is the empty call. Naming a session is a thing you
have to stop and do, and on the machine this was written for none of 71 sessions
had a name.

## What the model is shown

The messages from pi's `context` event — what it is about to send, after
compaction has replaced the older ones with a summary. For the session this was
built in that is 276 messages against 6482 in the file, and 12k tokens of
conversation against 1102k.

Tool results are left out. They are what a session did rather than what it was
about, and they are 90% of its bytes. A tool call arrives as its name alone.

Nothing is sampled or truncated: which part of a session gives it its name is
not something a rule can decide in advance, and at this size it all fits.

## Before anything is said

No name is offered. A session nobody has spoken in has nothing to be named
after, and `/rename <name>` still works.

## The model

Pinned to `claude-sonnet-4.6`, for the reason the tool-block summaries are: a
name whose voice changes because an account gained a model is worse than one
written by something weaker. An account without it falls back to the cheapest
model that has a price, so a name still arrives.

The language is the model's decision, from the conversation. A CJK-ratio test
calls Spanish, French, German and Russian all English.

## Where the name shows up

```
session selector    can filter to named sessions only
terminal title      pi - <name> - <cwd>
pi's own footer     ~/.pi • <name>
```

The footer in this repo does not show it.
