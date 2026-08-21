# behind

Say when the config repository has commits that are not here yet.

`~/.pi` is what pi runs from. Being behind means running an older version of
your own setup, and nothing else says so — git only complains when asked.

```
                              .pi is 3 commits behind main — git pull
```

Right-aligned, above the editor, not in the footer. The footer is where the numbers that are
always true live — context, cost, model — and a line that appears only when
something needs doing does not belong among them. It says what to do as well as
what is true, since a count alone leaves the reader to work that out.

Right alignment needs the width, and only a component is told the width — so
`setWidget` is given a factory rather than an array of lines. Padding is
measured with `visibleWidth`, which counts columns rather than bytes; the
colour escapes are half the string and none of the width. When the line is
wider than the terminal it overflows rather than truncating, since losing the
end of "git pull" to fit is worse.

## It clears itself

The check runs at `session_start` and again as turns go by, at most once every
five minutes. Pulling mid-session used to leave the reminder up until the next
start, telling you to do something already done — `setStatus` is now given the
result even when there is nothing to say, since `undefined` is what removes it.

Five minutes rather than every turn: the session this was written in ran 346
turns, and a network request per turn is not worth catching a pull a little
sooner.

## It does not block startup

The check talks to the network, about 200ms. `session_start` returns
immediately and the answer arrives in the footer a moment later; `setStatus`
writes to the footer's data provider and requests a render, so it works at any
time rather than only inside the handler.

## Why `fetch` and not `ls-remote`

`ls-remote` was the first attempt: it asks one question and writes nothing,
which sounded right for something running on every start.

It cannot count. Counting how far behind a checkout is needs both ends present,
and being behind is exactly the case where the remote's commits are not here —
`ls-remote` hands back a hash git then refuses to count to. Verified against a
clone reset two commits back: `unknown: remote commit not fetched`.

`fetch` brings the objects and writes only into `.git`. A test holds that HEAD
does not move and the working tree does not change.

## It says nothing rather than something wrong

No network, no remote, a detached head, a branch origin has never seen — each
comes back as `unknown` and shows nothing. A reminder that cannot be trusted is
worse than no reminder.

## Held by tests

Built against real repositories rather than mocks, because the case that
matters is the one where git's own behaviour is surprising. Seven tests: it
counts commits genuinely absent from the checkout, it stays quiet when current,
it leaves HEAD and the working tree untouched, and it reports rather than
throws when there is no repository or the remote is unreachable.
