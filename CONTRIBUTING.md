# Contributing

Thanks for helping out. This page tells you how.

Code is not the only way to contribute. Fixing typos, improving docs, triaging
issues, and reviewing pull requests all count.

## Setup

You need [Bun](https://bun.sh) 1+.

```sh
git clone https://github.com/devp0nt/route0.git
cd route0
bun install
```

## Commands

```sh
bun run test     # run tests
bun run types    # type-check
bun run lint     # lint and auto-fix
bun run build    # build to dist/
bun run smoke    # smoke-test the built package
```

Run `bun run test`, `bun run types`, and `bun run lint` before you push.

## Issues

- Search existing issues first, including closed ones.
- For a bug, include a minimal example that reproduces it. A runnable link is
  best.
- For a feature, explain the problem before the solution.

## Pull requests

- For large or breaking changes, open an issue first. Don't write a big PR that
  might get rejected.
- One PR, one topic. No unrelated changes.
- Match the existing code style.
- Add or update tests for your change.
- Work on a branch, not `main`.
- Keep "Allow edits from maintainers" checked.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Versions
and the changelog are generated from them, so the format matters.

```
feat: add wildcard route support
fix: handle trailing slash in getRelation
docs: clarify search params example
```

Mark a breaking change with `!`:

```
feat!: rename Route0.from() to Route0.create()
```

That's it. Open the PR and we'll take it from there.
