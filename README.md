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
pattern — `/idea/:id[int]&page[int]=0` — **once**, and from that single string
you get a typed path builder, a URL parser, typed path _and_ search params, a
[Standard Schema](https://standardschema.dev) validator with JSON Schema output,
and the matching primitives you'd build a router from. Params are inferred from
the pattern — types, enums, defaults and all; you never hand-write them.

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

One rule to know up front: **building never throws.** The TS types are the
strict layer; at runtime `get()` is best-effort — a value that slipped past the
types (a form field, a DB row, JSON) produces a link that at worst matches
nothing, a missing (or empty) required param emits the literal `undefined`, and
an unset or malformed `origin` just keeps the URL relative. A broken href is a
small bug; a page that dies rendering one is a big one. When you want loud
validation, that's what `.schema` and `.searchSchema` are for.

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
post.get({ locale: 'fr', slug: 'hello' }) // ✗ type error — at runtime builds '/fr/post/hello', which matches nothing

post.getRelation('/ru/post/hello').params // { locale: 'ru', slug: 'hello' }
post.isExact('/fr/post/hello') // false — 'fr' is not a locale

type Params = typeof post.Infer.ParamsOutput
// { locale: 'ru' | 'en'; slug: string }
```

The narrowing runs in both directions: `get()` rejects a value you didn't list
at the type level, and parsed params come back as the union — so a `switch` over
`locale` is exhaustive and a typo is a compile error instead of a 404 you find
in production. `.schema` validates against the same set (loudly, unlike
`get()`), and the JSON Schema it emits carries it as an `enum`.

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

## Give a param a type

Square brackets give a param a type. The param then matches only that type's
canonical string form, `get()` demands the matching JS type, and parsed params
come back converted — a real `number`, `boolean`, `bigint`, or `Date`:

```ts
const user = Route0.create('/users/:id[int]')

user({ id: 42 }) // '/users/42'
user({ id: '42' }) // ✗ type error — but the canonical string coerces at runtime: '/users/42'
user.getRelation('/users/42').params // { id: 42 }  — a number, not a string
user.isExact('/users/abc') // false
user.isExact('/users/007') // false — leading zeros are not canonical

type Params = typeof user.Infer.ParamsOutput // { id: number }
```

| Type         | Matches                                | JS value              |
| ------------ | -------------------------------------- | --------------------- |
| `[str]`      | anything — the default, spelled out    | `string`              |
| `[bool]`     | `true` · `false`                       | `boolean`             |
| `[int]`      | `0`, `42` — non-negative integers      | `number`              |
| `[-int]`     | `-7` too (never `-0`)                  | `number`              |
| `[num]`      | `3`, `1.5` — non-negative decimals     | `number`              |
| `[-num]`     | `-1.5`, `-0.5` too                     | `number`              |
| `[bigint]`   | like `[int]`, unlimited length         | `bigint`              |
| `[-bigint]`  | like `[-int]`, unlimited length        | `bigint`              |
| `[uuid]`     | `8-4-4-4-12` hex, either case          | `string`              |
| `[date]`     | `2026-08-26`                           | `Date` (UTC midnight) |
| `[datetime]` | ISO 8601 with a zone (`Z` or `±HH:MM`) | `Date`                |

Numeric types are **non-negative by default** — URL params are mostly ids, pages
and counts. The `-` modifier (`[-int]`, `[-num]`, `[-bigint]`) also allows the
minus.

Matching accepts **canonical forms only**: no leading zeros, no `+`, no
exponents, no trailing fraction zeros, no `-0`. That keeps building and parsing
a bijection — every URL that matches parses to a value that builds back into the
same URL. `.schema` enforces the same canon from the other side (`{ id: 1.5 }`
for `[int]` fails validation, so do `'007'` and an `Invalid Date`), while
`get()` — never-throw by policy — emits such values best-effort into a link that
matches nothing. At runtime both accept a typed value **or its canonical
string** (`'3'` for `[int]`, an ISO string for `[date]`) — everything on the
wire is a string anyway; the TS types stay strict. Combine with `?` for optional
as usual: `:page[int]?`. An id that can outgrow 2^53 belongs in `[bigint]` —
`[int]` matches any digit count, but `number` loses precision past
`Number.MAX_SAFE_INTEGER`.

Dates follow the JS spec's UTC convention: `[date]` parses to UTC midnight and
builds from the Date's UTC components — so create link dates as
`new Date('2026-08-26')`, not `new Date(2026, 7, 26)` (that's a _local_
midnight, which shifts a day in some timezones). `[datetime]` is the one
deliberate exception to strict bijection: parsing is lenient (a `Z` or a
`±HH:MM` offset, optional seconds — a `Date` holds the exact instant either
way), while building always emits the `toISOString()` canon.

Types feed the conflict analysis too: routes whose types can't share a URL
coexist freely, and genuinely ambiguous pairs are reported:

```ts
Route0.create('/x/:a[int]').isOverlap('/x/:b[uuid]') // false — no common URL
Route0.create('/x/:a[int]').isConflict('/x/:b[num]') // false — int is tried first
Route0.create('/x/:a[int]').isConflict('/x/:b[bigint]') // true — same strings, different values
```

`.schema` validates the typed values, and the JSON Schema it emits carries the
right shapes: `[int]` → `{ type: 'integer', minimum: 0 }`, `[bool]` →
`{ type: 'boolean' }`, `[uuid]` → `format: 'uuid'`, `[date]`/`[datetime]` →
`format: 'date'`/`'date-time'`. Two documented gaps, because JSON has neither
type: `[bigint]` is emitted as `integer` and the `Date`-valued types as
formatted strings.

## Prefix and suffix inside a segment

A param doesn't have to own its whole segment — wrap it in literal text:

```ts
const image = Route0.create('/files/img-:id[int].png')

image({ id: 7 }) // '/files/img-7.png'
image.getRelation('/files/img-7.png').params // { id: 7 }
image.isExact('/files/img-7.jpg') // false
image.isExact('/files/img-x.png') // false — the body is still [int]

Route0.create('/v:major[int]')({ major: 2 }) // '/v2'
Route0.create('/:file.mp4').getRelation('/talk.mp4').params // { file: 'talk' }
```

Prefix and suffix are URL-unreserved literals (`[A-Za-z0-9_.~-]`); a second
param is possible too, but only behind a delimiter — that's the next section. A
trailing `?` makes the whole segment optional — prefix and suffix drop out
together with the value:

```ts
const paged = Route0.create('/files/page-:n[int]?')
paged({}) // '/files'
paged({ n: 2 }) // '/files/page-2'
```

The param name is a `[A-Za-z0-9_]+` run, so a suffix starts at the first `.`,
`~` or `-` (`:file.mp4` — name `file`, suffix `.mp4`), and any `:` in a
non-wildcard segment is param intent: what doesn't parse is rejected at
creation, never silently downgraded to a static segment.

## A second param after a delimiter

The classic file-extension shape — and ranges, and versions. A segment may carry
a **tail param** after a one-character delimiter (`.`, `-` or `~`):

```ts
const file = Route0.create('/my/:slug.:ext')
file({ slug: 'talk', ext: 'md' }) // '/my/talk.md'
file.getRelation('/my/a.b.md').params // { slug: 'a.b', ext: 'md' }

const version = Route0.create('/v:maj[int].:min[int]')
version.getRelation('/v2.7').params // { maj: 2, min: 7 }

const range = Route0.create('/range/:from-:to')
range.getRelation('/range/a-b-c').params // { from: 'a-b', to: 'c' }
```

The rule that keeps this deterministic: **the tail can never contain its own
delimiter** — a plain tail matches everything but it, an enum/typed tail is
checked at creation (`:a-:d[date]` is rejected: a date contains `-`). So the
split always lands on the _last_ delimiter, the first param may contain it
freely, and building + parsing stay a round-trip (feeding a delimiter-carrying
value INTO a tail is the one thing `.schema` flags for it). At most two params
per segment, the tail always ends it.

A trailing `?` on a two-param segment makes the **tail** optional — the
delimiter disappears with it (on a single-param segment `?` still means the
whole segment):

```ts
const doc = Route0.create('/my/:slug.:ext?')
doc.getRelation('/my/talk.md').params // { slug: 'talk', ext: 'md' }
doc.getRelation('/my/talk').params // { slug: 'talk', ext: undefined }
doc({ slug: 'talk' }) // '/my/talk'
doc.schema.safeParse({ slug: 'a.md' }).success // false — would re-parse as slug 'a' + ext 'md'
doc({ slug: 'a.md', ext: 'txt' }) // '/my/a.md.txt' — providing the tail disambiguates
```

That validation failure is the bijection guard: a URL built without the tail
must not come back _with_ one (`get()` itself stays never-throw and emits what
you gave it). An enum tail narrows the guard to its own values —
`/:name.:ext(md|txt)?` parses `/a.pdf` as `name: 'a.pdf'` (`.pdf` is no valid
tail) and builds it back untouched.

### Wildcard tails

The same mechanics work on a wildcard — the file-server shapes:

```ts
const markdown = Route0.create('/docs/*.md')
markdown.isExact('/docs/a/b/c.md') // true
markdown.getRelation('/docs/a/b/c.md').params // { '*': 'a/b/c' }

const raw = Route0.create('/raw/*.:ext')
raw.getRelation('/raw/a/b.md').params // { '*': 'a/b', ext: 'md' }
raw.isExact('/raw/a.b/c') // false — no extension in the last segment
```

A wildcard with a suffix or tail demands a non-empty body (`/docs/.md` and
`/docs` don't match), the extension can only come from the **last** segment (the
tail never contains `/` or the delimiter), and `*.:ext?` behaves like the param
version, guard included. `*?` cannot carry a tail. Unlike a param's suffix, a
wildcard's _literal_ suffix may even start with a letter (`/files/*_thumb`) —
the star itself is the boundary, no name-run ambiguity to protect.

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

## Declare search params in the pattern

Search params can live right in the pattern, after the path, `&`-separated. Each
declaration is a name plus optional modifiers, in this order: a `[type]` **or**
an `(enum)`, then `[]` for an array, then `!` for required, then `=default`:

```ts
const list = Route0.create('/ideas&q&page[int]=0&sort(new|top)=new&ids[int][]')

list({ '?': { page: 2, sort: 'top' } }) // '/ideas?page=2&sort=top'
list({ '?': { page: '2' } }) // ✗ type error — but '2' coerces at runtime: '/ideas?page=2'
list({}) // '/ideas' — defaults are never inserted into a URL

list.searchParams.page // { required: false, array: false, type: 'int', default: 0 }

type Search = typeof list.Infer.SearchInput
// { q?: string | number; page?: number; sort?: 'new' | 'top'; ids?: number[] }
```

The rules, in brief:

- **Optional by default.** `&token!` makes one required: `get()`'s input type
  demands it and `searchSchema` fails without it (the never-throw `get()` just
  omits it from the URL). Matching is never affected — see below.
- **Defaults are parse-side only.** `&page[int]=0` means "absent in the URL ⇒
  `0` in the parsed output". Building never inserts a default; a `!` or a `[]`
  can't combine with `=` (rejected at creation).
- **Arrays.** `&ids[int][]` — the wire format is `ids[]=1&ids[]=2`, a single
  bare value counts as an array of one, and an absent array parses to `[]`,
  never `undefined`.
- **Strict vs loose.** Declaring params closes the `?` object to exactly those
  keys. A trailing `&` (`/ideas&page[int]&`) keeps it open — declared keys
  typed, anything else allowed. No `&` at all is today's fully-open behavior.
- **Matching stays pathname-only.** Search never decides `isExact` or
  `getRelation` — a route with a required search param still matches its path;
  validation is the schema's job.

### Parse and validate search

Every route carries a `searchSchema` (Standard Schema, like `.schema`): it takes
a parsed search object — raw URL strings and typed values alike — coerces
declared keys, fills defaults, wraps arrays, and drops unknown keys in strict
mode:

```ts
list.searchSchema.parse({ page: '2', ids: '7' })
// { q: undefined, page: 2, sort: 'new', ids: [7] }
list.searchSchema.safeParse({ page: 'abc' }).success // false
```

Its JSON Schemas mirror the coercion (input accepts the string forms,
`additionalProperties` follows strict/loose). For a forgiving view there's
`route.coerceSearch(obj)` — same conversion, but an invalid value degrades to
its absent case instead of failing. That's exactly what a collection applies on
a match, so `loc.search` arrives typed:

```ts
const routes = Routes.create({ list: '/ideas&q&page[int]=0&ids[int][]' })

routes._.getLocation('/ideas?q=x&page=2&ids=7').search
// { q: 'x', page: 2, ids: [7] }
routes._.getLocation('/ideas?page=abc').search
// { q: undefined, page: 0, ids: [] } — invalid degrades to the default
```

`extend()` concatenates declarations from both sides (duplicate names are
rejected), so a section base can declare shared search params once.

### `.search<T>()` — the escape hatch

The string can only declare flat scalars. For nested shapes, call `.search<…>()`
— a type-only refinement that merges _on top of_ the declared params (a key the
pattern already declares is a type error):

```ts
const filtered = Route0.create('/ideas&page[int]').search<{
  filter?: { price: { min: number; max: number } }
}>()

filtered.get({ '?': { page: 2, filter: { price: { min: 10, max: 50 } } } })
// '/ideas?page=2&filter[price][min]=10&filter[price][max]=50' (brackets encoded)
```

## Validate params with Standard Schema

Every route exposes a `.schema` that implements
[Standard Schema](https://standardschema.dev), so it parses and validates params
and drops into any pipeline that speaks the spec. A plain param coerces a
`number` to its string; a typed param validates and keeps its JS type:

```ts
const route = Route0.create('/x/:id/:slug?')

route.schema.safeParse({ id: 1 })
// { success: true, data: { id: '1', slug: undefined }, error: undefined } — number coerced
route.schema.safeParse({ slug: 'x' })
// { success: false, data: undefined, error: Error } — 'id' is required
route.schema.parse({ id: '1' }) // { id: '1', slug: undefined } — throws on invalid input
```

## OpenAPI

A route describes an OpenAPI operation completely, and two helpers hand it over.
`toUriTemplate()` is the path in the `{param}` template form OpenAPI's `paths`
object speaks — in-segment literals and tail params included, while a value
constraint, a param type or a trailing `?` never leak in.
`toOpenapiParameters()` is the matching `parameters` array: every path param
(always `required: true` — the spec demands it), then every declared search
param as `in: 'query'` with the canonical typed schema, arrays wrapped and
defaults attached:

```ts
const route = Route0.create('/files/img-:id[int].png&page[int]=0&token!')

route.toUriTemplate() // '/files/img-{id}.png'
route.toOpenapiParameters()
// [
//   { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 0 } },
//   { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
//   { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
// ]
```

A wildcard has no template variable, so `toUriTemplate()` emits it verbatim
(`/docs/*`, `/raw/*.{ext}`) and `toOpenapiParameters()` skips it. For request
and response **bodies** keep using `.schema` / `.searchSchema` — both implement
Standard JSON Schema, so
`schema['~standard'].jsonSchema.input({ target: 'openapi-3.0' })` emits the
object form directly.

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
| `ParamsInputStringOnly` | Same as `ParamsInput`, but every param in its URL-string form.          |
| `ParamsOutput`          | Parsed params — required `string`, optional `string \| undefined`.      |
| `SearchInput`           | Everything `?` accepts: declared params + the `.search<…>()` addition.  |
| `SearchInputStringOnly` | Same, but every declared param in its URL-string form.                  |
| `SearchOutput`          | What `searchSchema` yields — coerced, defaults filled, arrays wrapped.  |

For a param restricted to a set of values, `string` above is that param's
literal union instead — and `ParamsInput` drops `number`, since a number could
never be one of the listed values. A typed param swaps in its JS type
everywhere: `:id[int]` is `number` in and out, `:d[date]` is `Date`.

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

// A typed param carries its type; segment prefix/suffix live on the token only
Route0.create('/files/img-:id[int].png').getTokens()
// [
//   { kind: 'static', value: 'files' },
//   { kind: 'param', name: 'id', optional: false, type: 'int', prefix: 'img-', suffix: '.png' },
// ]
Route0.create('/files/img-:id[int].png').params.id // { required: true, type: 'int' }

// A tail param rides on its segment's token; its descriptor is a param like any other
Route0.create('/my/:slug.:ext?').getTokens()
// [
//   { kind: 'static', value: 'my' },
//   { kind: 'param', name: 'slug', optional: false, tail: { name: 'ext', optional: true, delimiter: '.' } },
// ]

// Declared search params have their own descriptor map
Route0.create('/ideas&page[int]=0&ids[int][]').searchParams
// {
//   page: { required: false, array: false, type: 'int', default: 0 },
//   ids: { required: false, array: true, type: 'int' },
// }

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
