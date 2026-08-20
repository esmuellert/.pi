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
pnpm verify            # everything below
pnpm check:pi-version  # catalog pin vs installed pi
pnpm test              # unit + contract tests
pnpm typecheck         # tsc across the workspace
pnpm smoke             # each extension actually loads in pi
```

After upgrading pi:

```bash
pi update
cd ~/.pi/agent/extensions
pnpm check:pi-version               # fails, naming the new version
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
| `check:pi-version` | pi moved and nothing here has been re-verified against it. |
| `typecheck` | API shape drift. Found a `pi.on("reload")` handler for an event that does not exist — dead code that the tests and manual use had both missed. |
| `test` | Our own logic (against stubs), plus `contract.test.ts` in each package for behaviour types cannot state: that `visibleWidth` measures a Nerd Font glyph as one column, that `SessionManager.create` does not write a file, that the theme still defines the colour keys the footer paints with. |
| `smoke` | The extension still loads in a real pi. |

The unit tests would keep passing if pi changed every API underneath them, which
is why the other layers exist. There is no bespoke check runner: the contract
checks are ordinary `node:test` files, so turbo caches them like anything else.
