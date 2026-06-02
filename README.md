# @devp0nt/route0

> A strongly-typed URL router for TypeScript — define a route once, then build
> paths and parse URLs with full type inference.

[![CI](https://github.com/devp0nt/route0/actions/workflows/ci.yml/badge.svg)](https://github.com/devp0nt/route0/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@devp0nt/route0.svg)](https://www.npmjs.com/package/@devp0nt/route0)
[![coverage](https://codecov.io/gh/devp0nt/route0/branch/main/graph/badge.svg)](https://codecov.io/gh/devp0nt/route0)
[![gzip](https://deno.bundlejs.com/badge?q=@devp0nt/route0)](https://bundlejs.com/?q=@devp0nt/route0)
[![license](https://img.shields.io/npm/l/@devp0nt/route0.svg)](./LICENSE)

<!-- docs:start -->

You write a URL pattern like `/users/:id` once. `route0` gives you both
directions from it: build a path from typed params, and parse a real URL back
into typed params. Params are inferred from the pattern string — no manual
types. It also handles search query strings (including nested objects), optional
segments, wildcards, route collections, and param validation via
[Standard Schema](https://standardschema.dev).

```ts
import { Route0, Routes } from '@devp0nt/route0'

const userRoute = Route0.create('/users/:id')

// build a path — call the route directly, or use .get(); params are typed
userRoute({ id: 42 }) // '/users/42'
userRoute.get({ id: 42 }) // same thing

// search params (nested objects + arrays) and a hash are always available
userRoute({
  id: 42,
  '?': { tab: 'reviews', sort: ['recent', 'top'] },
  '#': 'top',
})
// '/users/42?tab=reviews&sort[]=recent&sort[]=top#top'  (brackets URL-encoded)

// parse a real URL back into typed params
const rel = userRoute.getRelation('/users/42')
rel.type // 'exact'
rel.params // { id: '42' }

// or define a whole collection at once
const routes = Routes.create({
  home: '/',
  user: '/users/:id',
})
routes.user({ id: 42 }) // '/users/42'
```

## Install

```sh
bun add @devp0nt/route0
# or: npm install / pnpm add / yarn add
```

Bun 1+ or Node.js 20+. ESM only. `@devp0nt/flat0` is a peer dependency (used for
search-string encoding); `@standard-schema/spec` is optional.

## Build a path

`Route0.create(pattern)` returns a route. Call it directly, or use `.get()` —
they do the same thing. Params from the pattern are required and typed:

```ts
const route = Route0.create('/org/:org/users/:id')

route.get({ org: 'acme', id: '42' }) // '/org/acme/users/42'
route({ org: 'acme', id: '42' }) // same thing — the route is callable
```

## Params: optional and wildcard

Mark a param optional with `?`, or capture the rest with `*`:

```ts
const post = Route0.create('/users/:id/posts/:slug?')
post.get({ id: '1', slug: 'hello' }) // '/users/1/posts/hello'
post.get({ id: '1' }) // '/users/1/posts'  — optional param dropped

const files = Route0.create('/files/*')
files.getRelation('/files/a/b/c.txt').params // { '*': '/a/b/c.txt' }
```

## Search params and hash

Pass search params under the `?` key and a fragment under `#`. Arrays and deeply
nested objects are encoded for you:

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
// (brackets are URL-encoded in the returned string)

userRoute.get({ id: 9, '#': 'reviews' }) // '/users/9#reviews'
```

## Absolute URLs

Pass an `origin` in the options object — `true` uses `window.location.origin`
(or the route's configured origin), or hand it an explicit string:

```ts
userRoute.get({ id: '1' }, { origin: true }) // 'https://example.com/users/1'
userRoute.get({ id: '1' }, { origin: 'https://cdn.example.com' }) // 'https://cdn.example.com/users/1'
```

`route.abs()` is the same as `get()` but defaults `origin` to `true`, so it's
the shorthand when you always want an absolute URL:

```ts
userRoute.abs({ id: '1' }) // 'https://example.com/users/1'
userRoute.abs({ id: '1' }, { origin: false }) // '/users/1'  — opt back out
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

## Parse a URL

`getRelation()` matches a URL against the route and tells you how they relate —
`exact`, `ancestor`, `descendant`, or `unmatched` — with typed params:

```ts
const route = Route0.create('/users/:id')

route.getRelation('/users/42') // { type: 'exact', params: { id: '42' }, ... }
route.getRelation('/users') // { type: 'ancestor', ... }
route.getRelation('/users/42/posts') // { type: 'descendant', ... }
route.getRelation('/about') // { type: 'unmatched', ... }
```

This is what powers "is this link active?" and breadcrumb logic without string
juggling.

## A collection of routes

Group routes with `Routes.create()`, then match any pathname against the whole
set at once. Each route stays individually typed and callable:

```ts
const routes = Routes.create({
  home: '/',
  users: '/users',
  userDetail: Route0.create('/users/:id'),
})

routes.userDetail.get({ id: '3' }) // '/users/3'

// match a pathname against the collection
const loc = routes._.getLocation('/users/123')
loc.route // '/users/:id'  — the pattern that matched
loc.params // { id: '123' }
loc.pathname // '/users/123'
```

## Validate params with Standard Schema

Every route exposes a `.schema` that implements
[Standard Schema](https://standardschema.dev), so it parses and validates params
(and coerces them to strings) like any other schema:

```ts
const route = Route0.create('/x/:id/:slug?')

route.schema.safeParse({ id: '1' }) // { success: true, data: { id: '1', slug: undefined } }
route.schema.safeParse({ slug: 'x' }) // { success: false, error: ... } — `id` is required
route.schema.parse({ id: 1 }) // { id: '1' } — throws on invalid input
```

## Extend a route

Build longer routes from a shared base:

```ts
const admin = Route0.create('/admin')
const adminUser = admin.extend('/users/:id')

adminUser.get({ id: '5' }) // '/admin/users/5'
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
| `ParamsDefinition`      | Map of param name → `true` (required) / `false` (optional).             |
| `ParamsInput`           | What `get()` accepts — required as `string \| number`, optional opt-in. |
| `ParamsInputStringOnly` | Same as `ParamsInput`, but strings only (no `number`).                  |
| `ParamsOutput`          | Parsed params — required `string`, optional `string \| undefined`.      |
| `SearchInput`           | The route's typed search params (set via `.search<…>()`).               |

## API reference

### `Route0`

| Call                              | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| `Route0.create(pattern, config?)` | Create a route from a pattern (or clone a route).   |
| `Route0.from(definition)`         | Normalize a definition into a callable route.       |
| `Route0.getLocation(url)`         | Parse any URL/href/location into a location object. |

### Route instance

| Call                          | Result                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `route(input?, options?)`     | Build a path (callable form).                             |
| `route.get(input?, options?)` | Build a path (same as calling it).                        |
| `route.abs(input?, options?)` | Build a path, `origin` defaulting to `true`.              |
| `route.getRelation(url)`      | Match a URL → `{ type, params, ... }`.                    |
| `route.getParamsKeys()`       | The param names in the pattern.                           |
| `route.getTokens()`           | The parsed pattern structure.                             |
| `route.extend(suffix)`        | A new route with the suffix appended.                     |
| `route.schema`                | A Standard Schema for the params (`parse` / `safeParse`). |
| `route.definition`            | The pattern string.                                       |
| `typeof route.Infer.*`        | Type-only inference (`ParamsInput`, `ParamsOutput`, …).   |

**Options** (`get` / `abs` second argument): `origin` (`boolean | string` —
`true` uses the configured origin, a string overrides it; defaults to `true` for
`abs`) and `encode` (default `true`; `false` emits a human-readable, unencoded
path and search string).

### `Routes`

| Call                        | Result                                              |
| --------------------------- | --------------------------------------------------- |
| `Routes.create(record)`     | A typed collection; each value is a callable route. |
| `routes._.getLocation(url)` | Match a URL against the whole collection.           |

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **TypeScript 5+** (optional — works in plain JS too)
- Peer: `@devp0nt/flat0`; optional peer: `@standard-schema/spec`

<!-- docs:end -->

## Community

Questions, bugs, or want to hang with other builders? Join the devp0nt community
— one hub for all our open-source projects, this one included. Get help, share
what you built, or just say hi: [p0nt.dev/community](https://p0nt.dev/community)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). Security reports:
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

---

```text
Building open-source software for the glory of the Lord Jesus Christ ☦️
With love for developers of all backgrounds around the world ❤️
Sergei Dmitriev, 2026 😎
```
