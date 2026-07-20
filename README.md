# @1gr14/route0

> Type-safe URL paths for TypeScript. Write a pattern like `/users/:id` once and
> get a fully-typed path builder and URL parser out of it — params inferred from
> the string. Not a router: the typed path toolkit you build your own router on,
> or wire into the one you already use.

[![CI](https://github.com/1gr14/route0/actions/workflows/ci.yml/badge.svg)](https://github.com/1gr14/route0/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@1gr14/route0.svg)](https://www.npmjs.com/package/@1gr14/route0)
[![coverage](https://codecov.io/gh/1gr14/route0/branch/main/graph/badge.svg)](https://codecov.io/gh/1gr14/route0)
[![gzip](https://deno.bundlejs.com/badge?q=@1gr14/route0)](https://bundlejs.com/?q=@1gr14/route0)
[![license](https://img.shields.io/npm/l/@1gr14/route0.svg)](./LICENSE)

<!-- docs:start -->

route0 turns a URL pattern into a set of fully-typed helpers. You write the
pattern — `/idea/:id` — **once**, and from that single string you get a typed
path builder, a URL parser, search-param handling, a
[Standard Schema](https://standardschema.dev) validator, and the matching
primitives you'd build a router from. Params are inferred from the pattern; you
never hand-write their types.

## Why

Most apps — whatever the framework — need to declare paths, for pages or for API
endpoints. The crude way is to scatter string literals:
`<Route path="/idea/:id" />` in one place, `<Link to="/idea/123" />` in another.
Rename the path and you're hand-fixing every call site, with no type checker to
catch the one you missed.

A tidier attempt is a `routes.ts` full of functions like
`const ideaView = (id: string) => '/idea/' + id`. Better — but you still declare
every argument by hand, and the moment you want search params, a hash, or an
absolute URL, you're back to gluing strings together.

route0 derives all of that from the pattern itself:

```ts
import { Route0 } from '@1gr14/route0'

const ideaView = Route0.create('/idea/:id')

ideaView({ id: 123 }) // '/idea/123'
ideaView.abs({ id: 123 }) // 'https://example.com/idea/123'
ideaView({ id: 123, '?': { ref: 'feed' } }) // '/idea/123?ref=feed'
ideaView({ id: 123, '#': 'comments' }) // '/idea/123#comments'
ideaView.definition // '/idea/:id'
```

## Not a router

route0 doesn't match requests or render pages — it's the typed-path layer that
sits _under_ a router. Bring your own, plug it into an existing one, or use
[Point0](https://1gr14.dev/point0), which has route0 built in. The matching
primitives further down (`getRelation`, the `is*` checks, specificity ordering)
are exactly what you need to wire one up.

## Install

```sh
bun add @1gr14/route0 @1gr14/flat
# or: npm install / pnpm add / yarn add
```

Bun 1+ or Node.js 20+. ESM only. `@1gr14/flat` is a required peer dependency
(used for search-string encoding) — install it alongside route0, since pnpm and
yarn don't auto-install peers. `@standard-schema/spec` is an optional peer.

## Build a path

`Route0.create(pattern)` returns a route. The route is **callable** — call it
directly, or use `.get()`; they do the same thing. Params named in the pattern
(`:org`, `:id`) are required, typed, and accept a `string` or a `number`:

```ts
const route = Route0.create('/org/:org/users/:id')

route({ org: 'acme', id: 42 }) // '/org/acme/users/42'  — callable form
route.get({ org: 'acme', id: 42 }) // same thing
route.definition // '/org/:org/users/:id'  — the pattern back out
route.params // { org: { required: true, type: 'string' }, id: { required: true, type: 'string' } }
```

## Optional and wildcard params

Mark a param optional with a trailing `?`, or capture the rest of the path with
`*`:

```ts
const post = Route0.create('/users/:id/posts/:slug?')
post.get({ id: '1', slug: 'hello' }) // '/users/1/posts/hello'
post.get({ id: '1' }) // '/users/1/posts'  — optional param dropped

const files = Route0.create('/files/*')
files.get({ '*': 'a/b/c.txt' }) // '/files/a/b/c.txt'
files.getRelation('/files/a/b/c.txt').params // { '*': 'a/b/c.txt' }
```

A wildcard always lives under the `'*'` key. It may be a whole segment (`/*`) or
inline within one (`/files/x*`); only one wildcard is allowed, and it must come
last.

## Restrict a param to a set of values

List the values a param accepts in parentheses. The param then matches only
those values, and its type narrows from `string` to the literal union:

```ts
const post = Route0.create('/:locale(ru|en)/post/:slug')

post.get({ locale: 'ru', slug: 'hello' }) // '/ru/post/hello'
post.get({ locale: 'fr', slug: 'hello' }) // ✗ type error — and throws at runtime

post.getRelation('/ru/post/hello').params // { locale: 'ru', slug: 'hello' }
post.isExact('/fr/post/hello') // false — 'fr' is not a locale

type Params = typeof post.Infer.ParamsOutput
// { locale: 'ru' | 'en'; slug: string }
```

The narrowing runs in both directions: `get()` rejects a value you didn't list,
and parsed params come back as the union — so a `switch` over `locale` is
exhaustive and a typo is a compile error instead of a 404 you find in
production. `.schema` validates against the same set, and the JSON Schema it
emits carries it as an `enum`.

Add `?` after the closing parenthesis to make the param optional, exactly as
with a plain one — which is how you get an optional locale prefix:

```ts
const routes = Routes.create({
  home: '/:locale(ru|en)?',
  author: '/:locale(ru|en)?/author',
})

routes._.getLocation('/author').params // { locale: undefined }
routes._.getLocation('/ru/author').params // { locale: 'ru' }
routes._.getLocation('/zz/author').route // undefined — a real 404
```

Without the constraint, `/zz/author` would match with `locale: 'zz'`, and any
unknown first segment would quietly become a valid locale.

Two routes whose value sets don't overlap can share a shape without becoming
ambiguous:

```ts
Route0.create('/:locale(ru|en)/x').isConflict('/:kind(new|old)/x') // false
Route0.create('/:locale(ru|en)/x').isConflict('/:other(en|de)/x') // true — 'en' is in both
```

### What a value may contain

A value is built from URL-unreserved characters — letters, digits, `_`, `.`,
`~`, `-`. That keeps its encoded and decoded forms identical, so a match never
depends on how the client encoded the URL. Anything else is rejected when the
route is created, as are duplicates and empty values:

```ts
Route0.create('/:locale(ru|en)') // fine
Route0.create('/:locale(ru|EN)') // fine — matching is case-sensitive
Route0.create('/:locale(ru|рус)') // ✗ throws — non-ASCII
Route0.create('/:path(a/b)') // ✗ throws — a '/' can't live inside one segment
Route0.create('/:locale(ru|ru)') // ✗ throws — duplicate value
```

Rejection happens at creation, with a message naming the grammar. A malformed
param never degrades into a literal path segment that silently matches nothing.

A param may list at most **32 values**. The cap exists because the union is
built in the type system: somewhere past fifty alternatives TypeScript gives up
with an "excessively deep" error at the call site, which tells you nothing about
what went wrong. The cap turns that into a clear message instead. If you need a
larger set, use a plain param and check the value yourself.

## Search params and hash

Pass search params under the `?` key and a fragment under `#`. Arrays and deeply
nested objects are encoded for you (this is what the `@1gr14/flat` peer is for):

```ts
const search = Route0.create('/search')

search.get({
  '?': {
    q: 'shoes',
    tags: ['sale', 'new'],
    filters: { price: { min: 10, max: 50 } },
  },
})
// '/search?q=shoes&tags[]=sale&tags[]=new&filters[price][min]=10&filters[price][max]=50'
// (the brackets are percent-encoded in the returned string)

ideaView.get({ id: 9, '#': 'reviews' }) // '/idea/9#reviews'
```

## Absolute URLs

Pass an `origin` in the options object — `true` uses the route's configured
origin (or `window.location.origin` in the browser), or hand it an explicit
string:

```ts
const ideaView = Route0.create('/idea/:id', { origin: 'https://1gr14.dev' })

ideaView.get({ id: 1 }, { origin: true }) // 'https://1gr14.dev/idea/1'
ideaView.get({ id: 1 }, { origin: 'https://cdn.1gr14.dev' }) // 'https://cdn.1gr14.dev/idea/1'
```

`route.abs()` is the same as `get()` but defaults `origin` to `true`, so it's
the shorthand when you always want an absolute URL:

```ts
ideaView.abs({ id: 1 }) // 'https://1gr14.dev/idea/1'
ideaView.abs({ id: 1 }, { origin: false }) // '/idea/1'  — opt back out
```

## Pretty, unencoded paths

By default path params and the search string are percent-encoded. Pass
`encode: false` for a human-readable URL — handy for display:

```ts
const file = Route0.create('/files/:name')
file.get({ name: 'a b' }) // '/files/a%20b'
file.get({ name: 'a b', '?': { q: 'x y' } }) // '/files/a%20b?q=x%20y'
file.get({ name: 'a b', '?': { q: 'x y' } }, { encode: false }) // '/files/a b?q=x y'
```

## Extend a route

Need a shared prefix for a whole section? `route.extend(suffix)` appends to an
existing route and returns a new one — types and all — so you declare the base
once and grow from it:

```ts
const ideaBase = Route0.create('/idea')
const ideaView = ideaBase.extend('/:id')
const ideaEdit = ideaView.extend('/edit')

ideaView.definition // '/idea/:id'
ideaView({ id: '123' }) // '/idea/123'

ideaEdit.definition // '/idea/:id/edit'
ideaEdit({ id: '123' }) // '/idea/123/edit'
```

## Typed search params

Search params are untyped by default. Call `.search<…>()` to lock in a shape —
it's a type-only refinement (no runtime cost) that flows into `get()` and into
the `Infer` types below:

```ts
const list = Route0.create('/idea').search<{
  page?: number
  sort?: 'new' | 'top'
}>()

list.get({ '?': { page: 2, sort: 'top' } }) // '/idea?page=2&sort=top'
list.get({ '?': { sort: 'nope' } }) // ✗ type error — 'nope' is not assignable
```

## Validate params with Standard Schema

Every route exposes a `.schema` that implements
[Standard Schema](https://standardschema.dev), so it parses and validates params
(and coerces them to strings) and drops into any pipeline that speaks the spec:

```ts
const route = Route0.create('/x/:id/:slug?')

route.schema.safeParse({ id: 1 })
// { success: true, data: { id: '1', slug: undefined }, error: undefined } — number coerced
route.schema.safeParse({ slug: 'x' })
// { success: false, data: undefined, error: Error } — 'id' is required
route.schema.parse({ id: '1' }) // { id: '1', slug: undefined } — throws on invalid input
```

## Infer types from a route

Every route carries a type-only `Infer` field, so you can pull its types
straight off the instance with `typeof` — no generics, no helper imports:

```ts
const route = Route0.create('/users/:id/:tab?').search<{ ref?: string }>()

type ParamsInput = typeof route.Infer.ParamsInput
// { id: string | number; tab?: string | number | undefined }

type ParamsOutput = typeof route.Infer.ParamsOutput
// { id: string; tab: string | undefined }

type SearchInput = typeof route.Infer.SearchInput
// { ref?: string }
```

`Infer` exists only at the type level (its runtime value is `null`), so always
read it through `typeof`. The members:

| Member                  | What it is                                                              |
| ----------------------- | ----------------------------------------------------------------------- |
| `ParamsDefinition`      | Map of param name → its descriptor (see `params` above).                |
| `ParamsInput`           | What `get()` accepts — required as `string \| number`, optional opt-in. |
| `ParamsInputStringOnly` | Same as `ParamsInput`, but strings only (no `number`).                  |
| `ParamsOutput`          | Parsed params — required `string`, optional `string \| undefined`.      |
| `SearchInput`           | The route's typed search params (set via `.search<…>()`).               |

For a param restricted to a set of values, `string` above is that param's
literal union instead — and `ParamsInput` drops `number`, since a number could
never be one of the listed values.

Each member also exists as a standalone type — `ParamsOutput<typeof route>`,
`ParamsDefinition<'/:locale(ru|en)?'>`, and so on — taking either a route or a
pattern string. A single param reads straight off the descriptor:
`ParamsDefinition<typeof route>['locale']['required']`.

## Parse any URL

`Route0.getLocation(url)` is the inverse of building — it takes any href, path,
`URL`, or location-like object and returns a structured, route-agnostic location
(the search string is parsed with the same nested-aware rules used to build it):

```ts
const loc = Route0.getLocation('/search?q=shoes&tag[]=a&tag[]=b#results')

loc.pathname // '/search'
loc.search // { q: 'shoes', tag: ['a', 'b'] }  — parsed, nested-aware
loc.searchString // '?q=shoes&tag[]=a&tag[]=b'
loc.hash // '#results'
loc.hrefRel // '/search?q=shoes&tag[]=a&tag[]=b#results'  — pathname + search + hash
loc.abs // false  — input was relative
loc.route // undefined  — no route was matched against
loc.params // undefined
```

For an absolute input you also get `origin`, `href`, `host`, `hostname`, and
`port` filled in (otherwise they're `undefined`).

## Match a URL against a route

`getRelation(url)` matches a URL against the route and tells you how **the route
relates to that URL**, with typed params pulled out:

- `exact` — the URL _is_ this route.
- `ancestor` — the route is an ancestor of the URL (the URL is a deeper
  sub-path).
- `descendant` — the route is a descendant of the URL (the URL is a shallower
  prefix).
- `unmatched` — unrelated.

```ts
const route = Route0.create('/users/:id')

route.getRelation('/users/42')
// { type: 'exact', params: { id: '42' }, exact: true, ancestor: false, descendant: false, unmatched: false, route: '/users/:id' }
route.getRelation('/users/42/posts') // { type: 'ancestor',   params: { id: '42' }, ... }
route.getRelation('/users') // { type: 'descendant', params: {},          ... }
route.getRelation('/about') // { type: 'unmatched',  params: {},          ... }
```

When you only need a yes/no and not the params, the `is*` checks skip building
the relation object — cheaper on hot paths like rendering nav links:

```ts
route.isExact('/users/42') // true
route.isExactOrAncestor('/users/42/posts') // true  — "is this nav link active?"
route.isAncestor('/users/42/posts') // true
route.isDescendant('/users') // true
```

## A collection of routes

Keeping every route in its own variable gets noisy. `Routes.create()` gathers
them into one typed object — pass plain pattern strings, route instances, or a
mix. Each route stays individually typed and callable, reachable by its key:

```ts
import { Route0, Routes } from '@1gr14/route0'

const routes = Routes.create({
  ideaNew: '/idea/new',
  ideaView: Route0.create('/idea/:id'),
  ideaEdit: '/idea/:id/edit',
})

routes.ideaView({ id: '123' }) // '/idea/123'
routes.ideaEdit({ id: '123' }) // '/idea/123/edit'
```

Everything under `._` is the collection's own toolbox, kept on a separate key so
it never collides with your route names.

## Match against the whole collection

`routes._.getLocation(url)` matches a URL against every route at once and
returns the location of the first (most specific) **exact** match — enriched
with the matched `route` and its typed `params`:

```ts
const loc = routes._.getLocation('https://example.com/idea/123/edit?ref=feed')

loc.route // '/idea/:id/edit'  — the pattern that matched
loc.params // { id: '123' }
loc.search // { ref: 'feed' }
loc.pathname // '/idea/123/edit'
loc.hrefRel // '/idea/123/edit?ref=feed'
loc.href // 'https://example.com/idea/123/edit?ref=feed'
loc.abs // true

routes._.getLocation('/nope').route // undefined  — nothing matched
```

## Deterministic match order

A collection sorts its routes once, from most specific to least, and exposes
that order. This is what lets `/idea/new` and `/idea/:id` coexist: the static
route is tried first, so it wins the URL `/idea/new` instead of being swallowed
by the param route.

```ts
routes._.pathsOrdering // ['/idea/new', '/idea/:id', '/idea/:id/edit']  — patterns, specific first
routes._.keysOrdering // ['ideaNew', 'ideaView', 'ideaEdit']           — same order, by key
routes._.ordered[0].definition // '/idea/new'                          — same order, as route objects
```

The order is total and deterministic (independent of insertion order), so you
can feed `_.ordered` straight into a real router and trust that more specific
patterns always come first.

## Share a base origin

`routes._.clone(config)` returns a new collection with the config applied to
every route — the usual case is stamping an `origin` on the whole set so
`.abs()` works everywhere:

```ts
const absRoutes = routes._.clone({ origin: 'https://1gr14.dev' })
absRoutes.ideaView.abs({ id: 123 }) // 'https://1gr14.dev/idea/123'
```

A single route has the same `route.clone(config)`.

## Compare and order patterns yourself

When you're wiring up your own router, you sometimes need to reason about two
patterns directly. These comparators answer that:

```ts
const view = Route0.create('/idea/:id')
const fresh = Route0.create('/idea/new')

fresh.isMoreSpecificThan(view) // true  — a static segment beats a param
view.isOverlap(fresh) // true  — both can match '/idea/new'
view.isConflict(fresh) // false — ordering resolves it (try the static one first)

Route0.create('/idea/:id').isConflict('/idea/:slug')
// true — same shape, equally specific: no ordering can tell them apart
```

`isOverlap` asks whether two patterns can ever match the same URL; `isConflict`
narrows that to overlaps that ordering _can't_ resolve (genuine ambiguity you
have to fix); `isMoreSpecificThan` is the total order the collection sorts by.

## Lower-level building blocks

The pieces a router generator tends to reach for:

```ts
// Inspect a pattern's structure
Route0.create('/users/:id/posts/:slug?').getTokens()
// [
//   { kind: 'static', value: 'users' },
//   { kind: 'param', name: 'id', optional: false },
//   { kind: 'static', value: 'posts' },
//   { kind: 'param', name: 'slug', optional: true },
// ]
Route0.create('/org/:org/users/:id').getParamsKeys() // ['org', 'id']

// A restricted param carries its values on the token, and on its descriptor
Route0.create('/:locale(ru|en)?/author').getTokens()
// [
//   { kind: 'param', name: 'locale', optional: true, values: ['ru', 'en'] },
//   { kind: 'static', value: 'author' },
// ]
Route0.create('/:locale(ru|en)?/post/:slug').params.locale
// { required: false, type: 'enum', values: ['ru', 'en'] }
// an unrestricted param is `{ required, type: 'string' }` — no `values` key, and none on its token
// tokens and descriptors are frozen: mutating them would widen the schema without widening the matcher

// Normalize "route or string" inputs — returns the same instance if already a route
Route0.from('/users/:id') // a callable route
Route0.from(existingRoute) // the same instance, untouched

// One combined regex that matches any route in a set
const re = Route0.getRegexGroup([routes.ideaNew, routes.ideaView])
re.test('/idea/new') // true
```

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **TypeScript 5+** (optional — works in plain JS too)
- Peer: `@1gr14/flat`; optional peer: `@standard-schema/spec`

<!-- docs:end -->

## Community

Questions, bugs, or want to hang with other builders? Join the 1gr14 community —
one hub for all our open-source projects, this one included. Get help, share
what you built, or just say hi:
[1gr14.dev/#community](https://1gr14.dev/#community)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). Security reports:
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

---

Made by [1gr14](https://1gr14.dev), driven by
[community](https://1gr14.dev/#community)
