# @devp0nt/route0

> A strongly-typed URL router for TypeScript — define a route once, then build
> paths and parse URLs with full type inference.

[![CI](https://github.com/devp0nt/route0/actions/workflows/ci.yml/badge.svg)](https://github.com/devp0nt/route0/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@devp0nt/route0.svg)](https://www.npmjs.com/package/@devp0nt/route0)
[![license](https://img.shields.io/npm/l/@devp0nt/route0.svg)](./LICENSE)

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

Pass an origin (or `true` to use `window.location.origin`) as the second
argument:

```ts
userRoute.get({ id: '1' }, 'https://example.com') // 'https://example.com/users/1'
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

## API reference

### `Route0`

| Call                              | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| `Route0.create(pattern, config?)` | Create a route from a pattern (or clone a route).   |
| `Route0.from(definition)`         | Normalize a definition into a callable route.       |
| `Route0.getLocation(url)`         | Parse any URL/href/location into a location object. |

### Route instance

| Call                      | Result                                                    |
| ------------------------- | --------------------------------------------------------- |
| `route(input?, abs?)`     | Build a path (callable form).                             |
| `route.get(input?, abs?)` | Build a path (same as calling it).                        |
| `route.getRelation(url)`  | Match a URL → `{ type, params, ... }`.                    |
| `route.getParamsKeys()`   | The param names in the pattern.                           |
| `route.getTokens()`       | The parsed pattern structure.                             |
| `route.extend(suffix)`    | A new route with the suffix appended.                     |
| `route.schema`            | A Standard Schema for the params (`parse` / `safeParse`). |
| `route.definition`        | The pattern string.                                       |

### `Routes`

| Call                        | Result                                              |
| --------------------------- | --------------------------------------------------- |
| `Routes.create(record)`     | A typed collection; each value is a callable route. |
| `routes._.getLocation(url)` | Match a URL against the whole collection.           |

## Requirements

- **Bun 1+** or **Node.js 20+** (ESM only)
- **TypeScript 5+** (optional — works in plain JS too)
- Peer: `@devp0nt/flat0`; optional peer: `@standard-schema/spec`

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
