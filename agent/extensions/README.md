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
pnpm verify      # link-pi + test + typecheck + contract check
pnpm test        # turbo test
pnpm typecheck   # turbo typecheck
pnpm contract    # runtime contracts against the installed pi
pnpm link-pi     # re-point node_modules at the installed pi
```

After upgrading pi:

```bash
pi update && cd ~/.pi/agent/extensions && pnpm install && pnpm verify
```

`pnpm install` runs `link-pi` as a postinstall hook, so the symlinks follow pi to
its new store path.

## Dependencies

Tooling versions live in a single `catalog:` block in `pnpm-workspace.yaml`, so
every package references `"catalog:"` and cannot drift.

The pi packages are declared as `peerDependencies` with a `"*"` range, which is
what pi's own docs prescribe for anything it provides at runtime. `.npmrc` turns
off `auto-install-peers`: letting pnpm satisfy them pulls a second 200 MB copy of
pi into the workspace and puts a `pi` shim on PATH that shadows the real one.

## Why pi is symlinked rather than depended on

pi is installed globally, so it is not resolvable from this workspace and
TypeScript cannot see the types the extensions import. Adding it as a normal
devDependency would install a second copy that could drift from the one that
actually runs. `scripts/link-pi.mjs` instead reads pi's launcher shim to find the
real package and symlinks `@earendil-works/{pi-coding-agent,pi-tui,pi-ai}` into
`node_modules`, so type checking always targets the running version.

The links have to be rebuilt after every install, because pnpm prunes anything in
`node_modules` that no manifest mentions.

## Three layers of checking

Each catches something the others cannot:

| Layer | Catches |
|---|---|
| `typecheck` | API shape drift. Found a `pi.on("reload")` handler for an event that does not exist — dead code that tests and manual use had both missed. |
| `test` | Our own logic. 257 assertions, run against stubs. |
| `contract` | Runtime behaviour the types do not describe: that `visibleWidth` still measures Nerd Font glyphs as one column, that `SessionManager.create` does not write a file, that `getExtensionStatuses` is still a Map. |

The unit tests would keep passing if pi changed every API underneath them, which
is why the other two layers exist.
