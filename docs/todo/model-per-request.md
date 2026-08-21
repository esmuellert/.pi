# Use one model for the work and another for the reply

**Status:** open. The mechanism is verified; the boundary is not decided and the
last step is unchecked.

## The idea

Yanuo's, from working in `~/repos/codediff-1`: opus-5 does the earlier steps
well but writes replies that are hard to follow; opus-4.6 writes plainly but is
worse at the work. Run opus-5 for the tool calls and opus-4.6 for the final
reply, so each does what it is better at.

He also noted the split is not clean, because writing code is generation too,
and that a rule for who does what would need designing.

## What is verified

**A request's model can be replaced by an extension.** pi-ai's provider takes
an `onPayload(payload, model)` callback, documented as "inspecting or replacing
provider payloads before sending", and pi wires it to the `before_provider_request`
extension event:

```js
// core/sdk.js
onPayload: async (payload, _model) => runner.emitBeforeProviderRequest(payload)
```

Whatever a handler returns becomes the payload. The payload is the request body,
which carries the model.

**A second model would see the first's reasoning.** Thinking blocks are stored
in the session (794 of them in the `~/.pi` session at the time of writing) and
`buildContextEntries` does not filter them. So the concern that 4.6 would only
see tool calls and results, and have to reconstruct what happened, is wrong.

## What is not decided

**Where the line goes.** Tool calls versus reply does not cut it, since code
written into a file is also generated text.

One rule that was suggested but not settled — mine, not Yanuo's — is to split on
who judges the output: a compiler, a test or a runtime judges code and commands,
so those go to the stronger executor; a person judges replies, commit messages
and documentation, so those go to the plainer writer.

## What is not checked

**How to know, at request time, which kind of call this is.** The extension sees
only the request body. Whether the model will answer with tool calls or with a
final reply is not decided until it responds, and by then the request is sent.
What the extension could look at — whether the last message was a tool result,
how many calls this turn has made — is inference, not fact.

**Whether an already-generated assistant message can be replaced.** A way around
the timing problem is to let opus-5 finish the turn, then run opus-4.6 over the
turn's record and swap in its version of the final message. That needs a hook
that can replace a message after it exists. `message_end`, `turn_end` and
`agent_settled` were seen but look like notifications rather than interceptions;
none was checked. The cost is one extra full inference per turn, and opus-5's
reply is thrown away.

## Preceding idea

Before this, Yanuo raised putting a reviewer before the final reply — judging
whether it is what he wanted and regenerating if not. The model-split idea
replaced it in the conversation; the reviewer was not ruled out.
