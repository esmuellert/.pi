# response-footer

One line under each reply, right-aligned.

```
                  1 tool  39s  $0.897  cache 100%  ↑1.7M ↓1.3k
               10 tools  2m22s  $4.58  cache 100%  ↑8.6M ↓9.4k
               36 tools  4m37s  $8.08  cache 100%  ↑15.1M ↓15k
```

Narrow terminals drop from the end, so the leading figures stay put:

```
53 columns
     1 tool  39s  $0.897  cache 100%  ↑1.7M ↓1.3k
```

See it without writing anything:

```bash
node --experimental-strip-types mock/preview.ts
W=120 THEME=catppuccin-mocha node --experimental-strip-types mock/preview.ts
```

## Why it sits outside the reply's block

pi renders assistant messages with an internal component an extension cannot
reach. The only hook that touches one is `registerMarkdownTransformer`, which
takes and returns markdown source: no independent element, no colour of its own,
and no way to tell which message it was called for.

So the line is a separate `custom` entry appended after the reply. `appendEntry`
writes it to the session file, and `sessionEntryToContextMessages` returns
nothing for the `custom` type, so it survives a restart and never reaches the
model.

## A reply is many turns

pi emits a `turn_start` / `turn_end` pair per model call. A reply in the session
this was built in runs four at the median and 113 at the worst, so the tally
spans `agent_start` to `agent_end` rather than one turn.

## The sent figure counts everything

`↑1.7M` is every token the reply sent, cache included, because the whole context
goes over on each turn. Counting only fresh tokens reports 8 for a reply that
sent 1.7 million.

The hit rate is what separates the two, and it is what moves the bill: 72% of
replies here hit 99% or better, and the ones that miss cost several times more.

## Not backfilled

Only new replies get a line. The file is not rewritten to give older ones one.

## What breaks if this changes

`ENTRY` — the string `"response-footer"` — is shared by the writer and the
renderer through one constant. Renaming it orphans every entry already written:
they stay in the file and stop being drawn, with no error.

Fields inside `data` can be added or removed freely. The renderer reads each one
defensively, because an entry written by an older version is missing whatever
was added since, and pi draws a renderer that throws as a red error box.
