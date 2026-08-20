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

Loose `*.ts` files in this directory belong to other tools (the mobile client
installs some) and are deliberately outside the workspace.

## Commands

```bash
pnpm verify      # test + typecheck + contract check
pnpm test        # turbo test
pnpm typecheck   # turbo typecheck
pnpm contract    # runtime contracts against the installed pi
```

After upgrading pi:

```bash
pi update
cd ~/.pi/agent/extensions
pnpm contract                       # fails, naming the new version
# bump the pi versions in the catalog
pnpm install && pnpm verify
```

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
| `typecheck` | API shape drift. Found a `pi.on("reload")` handler for an event that does not exist — dead code that tests and manual use had both missed. |
| `test` | Our own logic. 257 assertions, run against stubs. |
| `contract` | Runtime behaviour the types do not describe: that `visibleWidth` still measures Nerd Font glyphs as one column, that `SessionManager.create` does not write a file, that `getExtensionStatuses` is still a Map. |

The unit tests would keep passing if pi changed every API underneath them, which
is why the other two layers exist.
