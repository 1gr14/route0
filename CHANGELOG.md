# Changelog

All notable changes to `@1gr14/route0`. Add notes under **Unreleased** as you
work; `bun run release` promotes that section to the new version.

## Unreleased

- Feature: params can be restricted to a set of values — `:name(a|b)` and
  `:name(a|b)?`. The set is enforced everywhere at once: matching, building,
  `.schema` validation, the emitted JSON Schema (a real `enum`), specificity and
  conflict detection. At the type level the param narrows from `string` to the
  literal union, in both directions — `get()` rejects an unlisted value, and
  parsed params come back as the union. A value is built from URL-unreserved
  characters only, so its encoded and decoded forms are identical; at most 32
  values per param, a cap that keeps TypeScript from failing with an
  "excessively deep" error instead of a readable one.
- Fix: a route whose extra segment names a finite set of values now takes the
  shared URL from its own prefix. `_compareSpecificity` ranked a segment the
  shorter route simply does not have as infinitely specific, so `/:locale?`
  sorted ahead of `/:locale?/author` and swallowed `/author` as
  `locale='author'` — along with every other single-segment top-level route. An
  absent segment now ranks above a wildcard, an optional param and a plain
  required param, but below a constrained param and a static segment. So
  `/:locale?/author` and `/:l?/:kind(new|top)` reclaim `/author` and `/new`,
  while a generic `/x/:p?/:q` still does not steal `/x/v` from `/x/:p?`. This
  fix is independent of constraints and applies to plain optional params too.
- Fix: a malformed `:`-segment throws at creation instead of silently degrading
  into a literal static segment that matches nothing. `:locale(ru|en)?` used to
  become a static literal, and the descendant matcher minted a phantom param
  named `locale(ru|en)`. `:prefix*` stays a legal prefixed wildcard.
- Fix: `:id*` now types as a wildcard under the `'*'` key, matching what the
  runtime has always done. The type-level segment reader tried `:${Name}` before
  the wildcard branches and typed it as a param called `id*`, which made
  `get({ '*': … })` a compile error on a route that works.
- Fix: `isOverlap` is now exact. It used to enumerate candidate paths, probing
  every param with invented values (`x`, `y`) and capping the candidate set at
  512, so it missed any overlap whose witness URL needs a param to take a value
  from the other route's own vocabulary — `/:a/x` and `/x/:b` both match `/x/x`,
  and were reported as not overlapping. It now walks both token sequences
  directly. Checked against brute-force ground truth over 20k random route
  pairs: the walk matches it on every pair, where the old enumeration was wrong
  on roughly one pair in eight — always a false negative.
- Fix: a duplicate param name (`/:a/:a`) now throws at creation. Previously the
  second occurrence silently overwrote the first in the params map, so one of
  the two segments could never be filled independently.
- Added: `route.getParamsValues()` (allowed values per constrained param),
  `Infer.ParamsValues`, and the standalone `ParamsValues` / `ParamsAllowedValues`
  helpers.
- Removed: `LocationParams`, an exported type that was a duplicate of
  `ParamsOutput` and referenced nowhere, in this repo or any consumer.

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
