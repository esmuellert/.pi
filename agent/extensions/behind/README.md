# behind

Say when the config repository has commits that are not here yet.

`~/.pi` is what pi runs from. Being behind means running an older version of
your own setup, and nothing else says so — git only complains when asked.

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
