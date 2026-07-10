# Changelog

All notable changes to `@1gr14/route0`. Add notes under **Unreleased** as you
work; `bun run release` promotes that section to the new version.

## Unreleased

## 0.1.3 — 2026-07-10

- Fix: `CallableRoute` now distributes over union definitions. Previously
  `CallableRoute<union>` normalized as an intersection of two unions — an N²
  cross-product that tripped TS2590 ("union type too complex") once a routes
  map crossed ~316 entries and was indexed by a generic key (e.g. a typed
  `navigate(name, input)` over 500+ routes).
- Tests: route-ordering guarantees pinned — `isMoreSpecificThan` is verified as
  a strict total order (antisymmetric, transitive), `makeOrdering` output is
  pairwise-consistent with it, and overlapping families (required vs optional
  params/wildcards, inline-wildcard vs param segments) resolve to the most
  specific route under every insertion order.
- CI: npm pinned to 11.x for the provenance publish (npm 12 over Node 24's
  bundled npm loses `sigstore`).
- Dev: `typescript-7` alias bumped to stable `typescript@7.0.2`.

## 0.1.2 — 2026-06-22

## 0.1.1 — 2026-06-15

- Maintenance: release tooling moved from semantic-release to in-house scripts
  (`bun run release` + an idempotent OIDC publish in CI). No library or API
  changes.

## 0.1.0 — 2026-06-08

### Features

- rebrand to `@1gr14/route0`
  ([675de90](https://github.com/1gr14/route0/commit/675de90354d66fa9671c1733f76d041bd02faf82))
