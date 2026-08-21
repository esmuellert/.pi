# pi extensions

Personal extensions for the [pi coding agent](https://pi.dev), managed as a pnpm
workspace with turbo.

pi discovers extensions by scanning this directory one level deep, so the
packages here are loaded straight from source — nothing is ever built. The
workspace exists for the tooling around them: one dependency set, one command to
verify everything, and type checking against the pi that is actually installed.

## Packages

| Package | What it does |
|---|---|
| `responsive-footer` | Width-adaptive multi-line footer. Wraps instead of abbreviating, so labels stay readable at any terminal size. |
| `cd` | `/cd <dir>` moves the session to another directory, which pi otherwise fixes at session creation. |
| `tool-blocks` | Presentation for tool blocks: a glyph per block, and a bash title with the layers pi gives its other six. |
| `frame-budget` | What a still frame may cost, and how to measure it. Shared by the packages that draw |
| `wheel` | How far one wheel event scrolls the fullscreen transcript, and probes to decide it |
| `themes` | Five dark themes generated from the upstream rose-pine and catppuccin palettes, so "official" is provable rather than claimed. |
| `moshi-push` | An iOS notification when a turn finishes. Moshi only rings for approvals and errors, so this borrows one and then corrects the card. |

The `themes` package is a generator rather than an extension: it writes
`~/.pi/agent/themes/*.json`, which pi reads.

Loose `*.ts` files in this directory belong to other tools (the mobile client
installs some) and are deliberately outside the workspace.

## Commands

```bash
pnpm check       # does this machine match the repo? changes nothing
pnpm bootstrap   # make it match: install the pinned pi, deps, then verify
pnpm upgrade-pi  # move the repo to a new pi and verify against it
pnpm verify      # test + typecheck + smoke
```

Everything in `setup.mjs` is idempotent: it reports what it found and only acts
when the machine does not already match.

```
$ pnpm bootstrap
bootstrap to pi 0.84.2
  skip  install pi globally (already 0.84.2)
  skip  install workspace deps (already in step with the catalog)
verify
  ...
This machine matches the repo.
```

## The repo controls pi

The catalog is the source of truth for which pi these extensions target, so pi
is upgraded through the repo rather than around it:

```bash
pnpm upgrade-pi            # latest
pnpm upgrade-pi 0.85.0     # a specific version
```

That rewrites the catalog, reinstalls, installs pi globally at that version, and
runs the full verification — so a pi that breaks an extension fails the upgrade
rather than being discovered later. Commit `pnpm-workspace.yaml` and
`pnpm-lock.yaml` afterwards.

Running `pi update` directly is what this replaces: it moves pi out from under
the repo, and `pnpm check` will say so.

## Setting up a new machine

```bash
git clone <this repo> ~/.pi
cd ~/.pi/agent/extensions
pnpm bootstrap             # installs pi at the pinned version, then verifies
pi                         # /login, since auth.json is not in the repo
```

If `~/.pi` already exists because pi has run there, adopt it instead of cloning
over it. `auth.json` and `sessions/` are ignored, so they survive:

```bash
cd ~/.pi
git init && git remote add origin <this repo>
git fetch && git checkout -f main
cd agent/extensions && pnpm bootstrap
```

Node is the only prerequisite: pnpm comes from corepack, which ships with it.

## Dependencies

All versions live in one `catalog:` block in `pnpm-workspace.yaml`; packages
reference `"catalog:"` and cannot drift from each other.

The pi packages appear twice, deliberately:

- **`peerDependencies: "*"`** — what pi's docs prescribe, declaring that pi
  supplies these at runtime and they must not be bundled.
- **`devDependencies: "catalog:"`** — pinned to an exact version so TypeScript
  has types to check against. pi is a global install and is not otherwise
  resolvable from here.

The pin is the point. When pi is upgraded the pin goes stale, `pnpm contract`
fails and names the new version, and you update the catalog and re-verify. A
symlink to whichever pi happens to be installed would keep type checking green
while silently following a version nobody had verified against — it would erase
exactly the signal that says "go check your extensions".

The second copy costs nothing: pnpm shares content with its store, so installing
pi again changed free disk by 1 MB (`du` reports 132 MB, which is copy-on-write
accounting).

## Three layers of checking

Each catches something the others cannot:

| Layer | Catches |
|---|---|
| `check:pi-version` | pi moved and nothing here has been re-verified against it. |
| `typecheck` | API shape drift. Found a `pi.on("reload")` handler for an event that does not exist — dead code that the tests and manual use had both missed. |
| `test` | Our own logic (against stubs), plus `contract.test.ts` in each package for behaviour types cannot state: that `visibleWidth` measures a Nerd Font glyph as one column, that `SessionManager.create` does not write a file, that the theme still defines the colour keys the footer paints with. |
| `smoke` | The extension still loads in a real pi. |

The unit tests would keep passing if pi changed every API underneath them, which
is why the other layers exist. There is no bespoke check runner: the contract
checks are ordinary `node:test` files, so turbo caches them like anything else.
