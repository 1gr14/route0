import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, expectTypeOf, it } from 'bun:test'
import { Route0, Routes } from './index.js'
import type {
  AnyLocation,
  AnyRoute,
  AnyRouteOrDefinition,
  CallableRoute,
  ExactLocation,
  Extended,
  ExtractRoute,
  ExtractRoutesKeys,
  GetPathInput,
  GetPathInputByRoute,
  HasParams,
  HasWildcard,
  IsParamsOptional,
  IsSameParams,
  KnownLocation,
  ParamsInput,
  ParamsInputStringOnly,
  ParamsOutput,
  RoutesPretty,
  UnknownLocation,
  UnknownSearchInput,
  WeakAncestorLocation,
  WeakDescendantLocation,
} from './index.js'

describe('Route0', () => {
  it('simple', () => {
    const route0 = Route0.create('/')
    const path = route0.get()
    const pathHash = route0.get({ '#': 'zxc' })
    expect(route0).toBeInstanceOf(Route0)
    expect(path).toBe('/')
    expectTypeOf<HasParams<typeof route0>>().toEqualTypeOf<false>()
    expect(pathHash).toBe('/#zxc')
  })

  it('simple, callable', () => {
    const route0 = Route0.create('/')
    const path = route0()
    const pathHash = route0({ '#': 'zxc' })
    expect(route0).toBeInstanceOf(Route0)
    expect(path).toBe('/')
    expect(pathHash).toBe('/#zxc')
  })

  it('create no slash', () => {
    const route0 = Route0.create('home')
    const path = route0()
    const pathHash = route0({ '#': 'zxc' })
    expect(route0.definition).toBe('/home')
    expect(path).toBe('/home')
    expect(pathHash).toBe('/home#zxc')
    expect(route0()).toBe(path)
    expect(route0({ '#': 'zxc' })).toBe(pathHash)
  })

  it('search', () => {
    const route0 = Route0.create('/')
    const path = route0.get({ '?': { q: '1' } })
    const pathHash = route0.get({ '?': { q: '1' }, '#': 'zxc' })
    expect(path).toBe('/?q=1')
    expect(pathHash).toBe('/?q=1#zxc')
    expect(route0({ '?': { q: '1' } })).toBe(path)
    expect(route0({ '?': { q: '1' }, '#': 'zxc' })).toBe(pathHash)
    expectTypeOf<(typeof route0)['Infer']['SearchInput']>().toEqualTypeOf<UnknownSearchInput>()
  })

  it('search deep object and array', () => {
    const route0 = Route0.create('/')
    const path = route0.get({
      '?': {
        filter: {
          status: 'open',
          meta: { page: 2 },
        },
        tags: ['a', 'b'],
      },
    })
    expect(decodeURIComponent(path)).toBe('/?filter[status]=open&filter[meta][page]=2&tags[]=a&tags[]=b')
  })

  it('search triple-nested object', () => {
    const route0 = Route0.create('/')
    const path = route0.get({ '?': { a: { b: { c: { d: 'deep' } } } } })
    expect(decodeURIComponent(path)).toBe('/?a[b][c][d]=deep')
  })

  it('search array of objects', () => {
    const route0 = Route0.create('/')
    const path = route0.get({
      '?': {
        form: {
          fields: [
            { name: 'email', type: 'text' },
            { name: 'age', type: 'number' },
          ],
          submit: 'true',
        },
      },
    })
    expect(decodeURIComponent(path)).toBe(
      '/?form[fields][][name]=email&form[fields][][name]=age&form[fields][][type]=text&form[fields][][type]=number&form[submit]=true',
    )
  })

  it('search array of primitives', () => {
    const route0 = Route0.create('/')
    const path = route0.get({ '?': { ids: ['10', '20', '30'] } })
    expect(decodeURIComponent(path)).toBe('/?ids[]=10&ids[]=20&ids[]=30')
  })

  it('params combined with deep search', () => {
    const route0 = Route0.create('/users/:id')
    const path = route0.get({
      id: '42',
      '?': { filter: { status: 'active', role: { level: 'admin' } }, tags: ['a', 'b'] },
    })
    expect(decodeURIComponent(path)).toBe('/users/42?filter[status]=active&filter[role][level]=admin&tags[]=a&tags[]=b')
  })

  it('typed search input', () => {
    const route0 = Route0.create('/').search<{ q: string }>()
    const path = route0.get({ '?': { q: '1' } })
    const pathHash = route0.get({ '?': { q: '1' }, '#': 'zxc' })
    const pathNoQuery = route0.get({ '#': 'zxc' })
    // @ts-expect-error invalid search param type
    const pathInvalidQueryType = route0.get({ '?': { q: 1 } })
    // @ts-expect-error invalid search param key
    const pathInvalidQueryKey = route0.get({ '?': { x: '1' } })
    expect(path).toBe('/?q=1')
    expect(pathHash).toBe('/?q=1#zxc')
    expect(pathNoQuery).toBe('/#zxc')
    expect(pathInvalidQueryType).toBe('/?q=1')
    expect(pathInvalidQueryKey).toBe('/?x=1')
    expectTypeOf<(typeof route0)['Infer']['SearchInput']>().toEqualTypeOf<{ q: string }>()
    expect(route0({ '?': { q: '1' } })).toBe(path)
    expect(route0({ '?': { q: '1' }, '#': 'zxc' })).toBe(pathHash)
    expect(route0({ '#': 'zxc' })).toBe(pathNoQuery)
    // @ts-expect-error invalid search param type
    expect(route0({ '?': { q: 1 } })).toBe(pathInvalidQueryType)
    // @ts-expect-error invalid search param key
    expect(route0({ '?': { x: '1' } })).toBe(pathInvalidQueryKey)
  })

  it('params', () => {
    const route0 = Route0.create('/prefix/:x/some/:y/:z')
    const path = route0.get({ x: '1', y: 2, z: '3' })
    const pathHash = route0.get({ x: '1', y: 2, z: '3', '#': 'zxc' })
    expect(path).toBe('/prefix/1/some/2/3')
    expectTypeOf<HasParams<typeof route0>>().toEqualTypeOf<true>()
    expect(pathHash).toBe('/prefix/1/some/2/3#zxc')
    expectTypeOf<(typeof route0)['Infer']['ParamsInput']>().toEqualTypeOf<{
      x: string | number
      y: string | number
      z: string | number
    }>()
    expectTypeOf<(typeof route0)['Infer']['ParamsOutput']>().toEqualTypeOf<{ x: string; y: string; z: string }>()
    expect(route0({ x: '1', y: 2, z: '3' })).toBe(path)
    expect(route0({ x: '1', y: 2, z: '3', '#': 'zxc' })).toBe(pathHash)
  })

  it('params and search', () => {
    const route0 = Route0.create('/prefix/:x/some/:y/:z')
    const path = route0.get({ x: '1', y: 2, z: '3', '?': { q: '1' } })
    const pathHash = route0.get({ x: '1', y: 2, z: '3', '?': { q: '1' }, '#': 'zxc' })
    expect(path).toBe('/prefix/1/some/2/3?q=1')
    expect(pathHash).toBe('/prefix/1/some/2/3?q=1#zxc')
    expect(route0({ x: '1', y: 2, z: '3', '?': { q: '1' } })).toBe(path)
    expect(route0({ x: '1', y: 2, z: '3', '?': { q: '1' }, '#': 'zxc' })).toBe(pathHash)
  })

  it('optional named params', () => {
    const route0 = Route0.create('/prefix/:x?/:y')
    expect(route0.get({ y: '2' })).toBe('/prefix/2')
    expect(route0.get({ x: '1', y: '2' })).toBe('/prefix/1/2')
    expectTypeOf<(typeof route0)['Infer']['ParamsDefinition']>().toEqualTypeOf<{ x: false; y: true }>()
    expectTypeOf<(typeof route0)['Infer']['ParamsInput']>().toEqualTypeOf<{
      y: string | number
      x?: string | number | undefined
    }>()
    expectTypeOf<(typeof route0)['Infer']['ParamsOutput']>().toEqualTypeOf<{
      y: string
      x: string | undefined
    }>()
  })

  it('wildcards and optional wildcards', () => {
    const routeWildcard = Route0.create('/app*')
    const routeOptionalWildcard = Route0.create('/orders/*?')
    expect(routeWildcard.get({ '*': '' })).toBe('/app')
    expect(routeWildcard.get({ '*': '/home' })).toBe('/app/home')
    expect(routeWildcard.get({ '*': '-1' })).toBe('/app-1')
    expect(routeWildcard.getRelation('/app').params).toStrictEqual({ '*': '' })
    expect(routeWildcard.getRelation('/app/home').params).toStrictEqual({ '*': '/home' })
    expect(routeOptionalWildcard.get()).toBe('/orders')
    expect(routeOptionalWildcard.get({ '*': 'completed/list' })).toBe('/orders/completed/list')
    expect(routeOptionalWildcard.getRelation('/orders').params).toStrictEqual({ '*': undefined })
    expect(routeOptionalWildcard.getRelation('/orders/').params).toStrictEqual({ '*': undefined })
    expect(routeOptionalWildcard.getRelation('/orders/completed/list').params).toStrictEqual({
      '*': 'completed/list',
    })
    expectTypeOf<(typeof routeWildcard)['Infer']['ParamsDefinition']>().toEqualTypeOf<{ '*': true }>()
    expectTypeOf<(typeof routeOptionalWildcard)['Infer']['ParamsDefinition']>().toEqualTypeOf<{ '*': false }>()
    expectTypeOf<(typeof routeWildcard)['Infer']['ParamsOutput']>().toEqualTypeOf<{ '*': string }>()
    expectTypeOf<(typeof routeOptionalWildcard)['Infer']['ParamsOutput']>().toEqualTypeOf<{ '*': string | undefined }>()
  })

  it('difference: /path/x* vs /path/x/* matching', () => {
    const inlineWildcard = Route0.create('/path/x*')
    const segmentWildcard = Route0.create('/path/x/*')

    // /path/x*:
    // - matches '/path/x'
    // - matches '/path/x123' (same segment continuation)
    // - matches '/path/x/123' (slash continuation)
    expect(inlineWildcard.getRelation('/path/x').params).toStrictEqual({ '*': '' })
    expect(inlineWildcard.getRelation('/path/x123').params).toStrictEqual({ '*': '123' })
    expect(inlineWildcard.getRelation('/path/x/123').params).toStrictEqual({ '*': '/123' })

    // /path/x/*:
    // - matches '/path/x' and '/path/x/...'
    // - '/path/x123' is unmatched (because 'x' is a full segment here)
    expect(segmentWildcard.getRelation('/path/x').params).toStrictEqual({ '*': undefined })
    expect(segmentWildcard.getRelation('/path/x/123').params).toStrictEqual({ '*': '123' })
    expect(segmentWildcard.getRelation('/path/x123').unmatched).toBe(true)
  })

  it('difference: /path/x* vs /path/x/* URL building', () => {
    const inlineWildcard = Route0.create('/path/x*')
    const segmentWildcard = Route0.create('/path/x/*')

    // Inline wildcard appends directly to the "x" prefix.
    expect(inlineWildcard.get({ '*': '123' })).toBe('/path/x123')
    expect(inlineWildcard.get({ '*': '/123' })).toBe('/path/x/123')

    // Segment wildcard appends as a new segment after '/path/x/'.
    expect(segmentWildcard.get({ '*': '123' })).toBe('/path/x/123')
    expect(segmentWildcard.get({ '*': '/123' })).toBe('/path/x/123')
  })

  it('throws when wildcard is not the final segment', () => {
    expect(() => Route0.create('/path/*/child')).toThrow(
      'Invalid route definition "/path/*/child": wildcard segment is allowed only at the end',
    )
    expect(() => Route0.create('/path/x*/child')).toThrow(
      'Invalid route definition "/path/x*/child": wildcard segment is allowed only at the end',
    )
  })

  it('throws when route has more than one wildcard segment', () => {
    expect(() => Route0.create('/path/*/x*')).toThrow(
      'Invalid route definition "/path/*/x*": only one wildcard segment is allowed',
    )
    expect(() => Route0.create('/path/x*/y*')).toThrow(
      'Invalid route definition "/path/x*/y*": only one wildcard segment is allowed',
    )
  })

  it('extend strips trailing wildcard from parent route', () => {
    const withInlineWildcard = Route0.create('/app*')
    const withSegmentWildcard = Route0.create('/orders/*?')
    const childA = withInlineWildcard.extend('/settings')
    const childB = withSegmentWildcard.extend('completed')
    expect(childA.definition).toBe('/app/settings')
    expect(childB.definition).toBe('/orders/completed')
    expect(childA.get()).toBe('/app/settings')
    expect(childB.get()).toBe('/orders/completed')
    expectTypeOf<(typeof childA)['definition']>().toEqualTypeOf<'/app/settings'>()
    expectTypeOf<(typeof childB)['definition']>().toEqualTypeOf<'/orders/completed'>()
  })

  it('mixed required and optional named params combinations', () => {
    const route = Route0.create('/org/:orgId/user/:userId?/:tab')
    expect(route.get({ orgId: 'acme', tab: 'settings' })).toBe('/org/acme/user/settings')
    expect(route.get({ orgId: 'acme', userId: '42', tab: 'settings' })).toBe('/org/acme/user/42/settings')

    const locNoOptional = route.getRelation('/org/acme/user/settings')
    expect(locNoOptional.params).toMatchObject({
      orgId: 'acme',
      userId: undefined,
      tab: 'settings',
    })

    const locWithOptional = route.getRelation('/org/acme/user/42/settings')
    expect(locWithOptional.params).toMatchObject({
      orgId: 'acme',
      userId: '42',
      tab: 'settings',
    })
  })

  it('consecutive optional named params are resolved deterministically', () => {
    const route = Route0.create('/users/:first?/:second?')

    expect(route.get()).toBe('/users')
    expect(route.get({ first: 'a' })).toBe('/users/a')
    expect(route.get({ first: 'a', second: 'b' })).toBe('/users/a/b')

    const locBase = route.getRelation('/users')
    expect(locBase.params).toMatchObject({
      first: undefined,
      second: undefined,
    })

    const locSingle = route.getRelation('/users/a')
    expect(locSingle.params).toMatchObject({
      first: 'a',
      second: undefined,
    })

    const locBoth = route.getRelation('/users/a/b')
    expect(locBoth.params).toMatchObject({
      first: 'a',
      second: 'b',
    })
  })

  it('all-optional route with nothing supplied collapses to "/"', () => {
    const route = Route0.create('/:x?/:y?')
    expect(route.get()).toBe('/')
    expect(route.get({ x: 'a' })).toBe('/a')
    expect(route.get({ x: 'a', y: 'b' })).toBe('/a/b')

    const prefixed = Route0.create('/a/:x?/:y?')
    expect(prefixed.get()).toBe('/a')
    expect(prefixed.get({ x: 'x' })).toBe('/a/x')

    const absolute = Route0.create('/:x?/:y?', { origin: 'https://example.com' })
    expect(absolute.abs()).toBe('https://example.com')
    expect(absolute.get(undefined, { origin: true })).toBe('https://example.com')
  })

  describe('getRelation', () => {
    it('exact match', () => {
      const route0 = Route0.create('/prefix/:x/some/:y/:z/suffix')
      let loc = route0.getRelation('/prefix/some/suffix')
      expect(loc.exact).toBe(false)
      expect(loc.unmatched).toBe(true)
      loc = route0.getRelation('/prefix/xxx/some/yyy/zzz/suffix')
      if (!loc.exact) {
        throw new Error('Expect is exact')
      }
      expect(loc.route).toBe('/prefix/:x/some/:y/:z/suffix')
      expectTypeOf<typeof loc.params>().toEqualTypeOf<{ x: string; y: string; z: string }>()
      expect(loc.params).toMatchObject({ x: 'xxx', y: 'yyy', z: 'zzz' })
    })

    it('ancestor match', () => {
      expect(Route0.create('/prefix/xxx/some').getRelation('/prefix/xxx/some/extra/path')).toMatchObject({
        type: 'ancestor',
        exact: false,
        unmatched: false,
        ancestor: true,
        descendant: false,
      })
      expect(Route0.create('/prefix/:x/some').getRelation('/prefix/xxx/some/extra/path')).toMatchObject({
        type: 'ancestor',
        exact: false,
        unmatched: false,
        ancestor: true,
        descendant: false,
        params: { x: 'xxx' },
      })
      expect(Route0.create('/:y/:x/some').getRelation('/prefix/xxx/some/extra/path')).toMatchObject({
        type: 'ancestor',
        exact: false,
        unmatched: false,
        ancestor: true,
        descendant: false,
        params: { y: 'prefix', x: 'xxx' },
      })
    })

    it('descendant match', () => {
      expect(Route0.create('/prefix/some/extra/path').getRelation('/prefix/some')).toMatchObject({
        type: 'descendant',
        exact: false,
        unmatched: false,
        ancestor: false,
        descendant: true,
        params: {},
      })
      expect(Route0.create('/prefix/some/extra/:id').getRelation('/prefix/some')).toMatchObject({
        type: 'descendant',
        exact: false,
        unmatched: false,
        ancestor: false,
        descendant: true,
        params: {},
      })
      expect(Route0.create('/:prefix/some/extra/:id').getRelation('/prefix/some')).toMatchObject({
        type: 'descendant',
        exact: false,
        unmatched: false,
        ancestor: false,
        descendant: true,
        params: { prefix: 'prefix' },
      })
    })

    it('unmatched', () => {
      expect(Route0.create('/prefix/some/extra/path').getRelation('/another/path')).toMatchObject({
        type: 'unmatched',
        exact: false,
        unmatched: true,
        ancestor: false,
        descendant: false,
        params: {},
      })
      expect(Route0.create('/prefix/:x/some').getRelation('/other/123')).toMatchObject({
        type: 'unmatched',
        exact: false,
        unmatched: true,
        ancestor: false,
        descendant: false,
        params: {},
      })
    })

    it('supports hash in input path', () => {
      const route0 = Route0.create('/path/:id')
      const relation = route0.getRelation('/path/123#section')
      expect(relation.exact).toBe(true)
      expect(relation.params).toMatchObject({ id: '123' })
    })
  })

  it('getTokens returns correct token objects', () => {
    const route = Route0.create('/users/:id/posts')
    const tokens = route.getTokens()
    expect(tokens).toEqual([
      { kind: 'static', value: 'users' },
      { kind: 'param', name: 'id', optional: false },
      { kind: 'static', value: 'posts' },
    ])
    tokens[0] = { kind: 'static', value: 'mutated' }
    expect(route.getTokens()[0]).toEqual({ kind: 'static', value: 'users' })
  })

  it('getTokens with optional params and wildcards', () => {
    expect(Route0.create('/').getTokens()).toEqual([])
    expect(Route0.create('/static').getTokens()).toEqual([{ kind: 'static', value: 'static' }])
    expect(Route0.create('/:id?').getTokens()).toEqual([{ kind: 'param', name: 'id', optional: true }])
    expect(Route0.create('/app*').getTokens()).toEqual([{ kind: 'wildcard', prefix: 'app', optional: false }])
    expect(Route0.create('/orders/*?').getTokens()).toEqual([
      { kind: 'static', value: 'orders' },
      { kind: 'wildcard', prefix: '', optional: true },
    ])
  })

  it('getParamsKeys returns param names', () => {
    expect(Route0.create('/').getParamsKeys()).toEqual([])
    expect(Route0.create('/users').getParamsKeys()).toEqual([])
    expect(Route0.create('/users/:id').getParamsKeys()).toEqual(['id'])
    expect(Route0.create('/users/:id/posts/:postId').getParamsKeys()).toEqual(['id', 'postId'])
    expect(Route0.create('/users/:id?').getParamsKeys()).toEqual(['id'])
    expect(Route0.create('/app*').getParamsKeys()).toEqual(['*'])
    expect(Route0.create('/orders/*?').getParamsKeys()).toEqual(['*'])
  })

  it('getRelation accepts URL instance', () => {
    const route = Route0.create('/users/:id')
    const url = new URL('https://example.com/users/42?tab=posts#section')
    const relation = route.getRelation(url)
    expect(relation.exact).toBe(true)
    if (relation.exact) {
      expect(relation.params).toStrictEqual({ id: '42' })
    }
  })

  it('encoded params round-trip through get() and getRelation()', () => {
    const route = Route0.create('/users/:name')
    const path = route.get({ name: 'hello world' })
    expect(path).toBe('/users/hello%20world')
    const relation = route.getRelation(path)
    expect(relation.exact).toBe(true)
    if (relation.exact) {
      expect(relation.params).toStrictEqual({ name: 'hello world' })
    }
  })

  it('special characters in param values are encoded and decoded', () => {
    const route = Route0.create('/files/:path')
    const path = route.get({ path: 'a/b' })
    expect(path).toBe('/files/a%2Fb')
    const relation = route.getRelation(path)
    expect(relation.exact).toBe(true)
    if (relation.exact) {
      expect(relation.params).toStrictEqual({ path: 'a/b' })
    }
  })

  it('rejects optional wildcard before required static segment', () => {
    expect(() => Route0.create('/orders/*?/details')).toThrow(
      'Invalid route definition "/orders/*?/details": wildcard segment is allowed only at the end',
    )
  })

  it('schema accepts optional-only and mixed params', () => {
    const optionalOnly = Route0.create('/x/:id?')
    expect(optionalOnly.schema.safeParse(undefined)).toMatchObject({
      success: true,
      data: { id: undefined },
      error: undefined,
    })

    const mixed = Route0.create('/x/:id/:slug?')
    expect(mixed.schema.safeParse({ id: '1' })).toMatchObject({
      success: true,
      data: { id: '1', slug: undefined },
      error: undefined,
    })
    expect(mixed.schema.safeParse({ slug: 'x' }).success).toBe(false)
  })

  it('simple extend', () => {
    const route0 = Route0.create('/prefix')
    const route1 = route0.extend('/suffix')
    const path = route1.get()
    const pathHash = route1.get({ '#': 'zxc' })
    // expectTypeOf<typeof path>().toEqualTypeOf<`/prefix/suffix`>()
    expect(path).toBe('/prefix/suffix')
    expect(pathHash).toBe('/prefix/suffix#zxc')
    expect(route1()).toBe(path)
    expect(route1({ '#': 'zxc' })).toBe(pathHash)
  })

  it('simple extend double slash', () => {
    const route0 = Route0.create('/')
    expect(route0.get()).toBe('/')
    const route1 = route0.extend('/suffix1/')
    expect(route1.get()).toBe('/suffix1')
    const route2 = route1.extend('/suffix2')
    const path = route2.get()
    const pathHash = route2.get({ '#': 'zxc' })
    // expectTypeOf<typeof path>().toEqualTypeOf<`/suffix1/suffix2`>()
    expect(path).toBe('/suffix1/suffix2')
    expect(pathHash).toBe('/suffix1/suffix2#zxc')
  })

  it('simple extend no slash', () => {
    const route0 = Route0.create('/')
    const route1 = route0.extend('suffix1')
    const route2 = route1.extend('suffix2')
    const path = route2.get()
    const pathHash = route2.get({ '#': 'zxc' })
    // expectTypeOf<typeof path>().toEqualTypeOf<`/suffix1/suffix2`>()
    expect(path).toBe('/suffix1/suffix2')
    expect(pathHash).toBe('/suffix1/suffix2#zxc')
  })

  it('simple extend no slash chaos', () => {
    const route0 = Route0.create('/')
    expectTypeOf<(typeof route0)['definition']>().toEqualTypeOf<'/'>()
    expect(route0.get()).toBe('/')

    const route1 = Route0.create('')
    expectTypeOf<(typeof route1)['definition']>().toEqualTypeOf<'/'>()
    expect(route1.get()).toBe('/')

    const route2 = route0.extend('/')
    expectTypeOf<(typeof route2)['definition']>().toEqualTypeOf<'/'>()
    expect(route2.get()).toBe('/')

    const route3 = route1.extend('/')
    expectTypeOf<(typeof route3)['definition']>().toEqualTypeOf<'/'>()
    expect(route3.get()).toBe('/')

    const route4 = route0.extend('path/')
    expectTypeOf<(typeof route4)['definition']>().toEqualTypeOf<'/path'>()
    expect(route4.get()).toBe('/path')

    const route5 = route1.extend('/path/')
    expectTypeOf<(typeof route5)['definition']>().toEqualTypeOf<'/path'>()
    expect(route5.get()).toBe('/path')

    const route6 = route1.extend('path')
    expectTypeOf<(typeof route6)['definition']>().toEqualTypeOf<'/path'>()
    expect(route6.get()).toBe('/path')
  })

  it('extend wildcard after slash', () => {
    const route0 = Route0.create('/prefix/*')
    const route1 = route0.extend('/suffix')
    const path = route1.get()
    const pathHash = route1.get({ '#': 'zxc' })
    // expectTypeOf<typeof path>().toEqualTypeOf<`/prefix/suffix`>()
    expect(path).toBe('/prefix/suffix')
    expect(pathHash).toBe('/prefix/suffix#zxc')
    expect(route1()).toBe(path)
    expect(route1({ '#': 'zxc' })).toBe(pathHash)
  })

  it('extend wildcard without slash', () => {
    const route0 = Route0.create('/prefix*')
    const route1 = route0.extend('/suffix')
    const path = route1.get()
    const pathHash = route1.get({ '#': 'zxc' })
    // expectTypeOf<typeof path>().toEqualTypeOf<`/prefix/suffix`>()
    expect(path).toBe('/prefix/suffix')
    expect(pathHash).toBe('/prefix/suffix#zxc')
    expect(route1()).toBe(path)
    expect(route1({ '#': 'zxc' })).toBe(pathHash)
  })

  it('normalizes routes to single-leading-slash canonical form', () => {
    const routeNoSlash = Route0.create('without-slash')
    expectTypeOf<(typeof routeNoSlash)['definition']>().toEqualTypeOf<'/without-slash'>()
    expect(routeNoSlash.get()).toBe('/without-slash')

    const routeMessy = Route0.create('///a////b///')
    expectTypeOf<(typeof routeMessy)['definition']>().toEqualTypeOf<'/a/b'>()
    expect(routeMessy.get()).toBe('/a/b')
  })

  it('extend with empty/root suffix keeps canonical parent route', () => {
    const base = Route0.create('/prefix/path/')
    expect(base.get()).toBe('/prefix/path')

    const extendedEmpty = base.extend('')
    expectTypeOf<(typeof extendedEmpty)['definition']>().toEqualTypeOf<'/prefix/path'>()
    expect(extendedEmpty.get()).toBe('/prefix/path')

    const extendedRoot = base.extend('/')
    expectTypeOf<(typeof extendedRoot)['definition']>().toEqualTypeOf<'/prefix/path'>()
    expect(extendedRoot.get()).toBe('/prefix/path')
  })

  it('extend with params', () => {
    const route0 = Route0.create('/prefix/:x')
    const route1 = route0.extend('/suffix/:y')
    const path = route1.get({ x: '1', y: '2' })
    const pathHash = route1.get({ x: '1', y: '2', '#': 'zxc' })
    expect(path).toBe('/prefix/1/suffix/2')
    expect(pathHash).toBe('/prefix/1/suffix/2#zxc')
  })

  it('extend with typed search', () => {
    const route0 = Route0.create('/prefix').search<{ y: string; z: string }>()
    const route1 = route0.extend('/suffix')
    const path = route1.get({ '?': { y: '2', z: '3' } })
    expectTypeOf<(typeof route1)['Infer']['SearchInput']>().toEqualTypeOf<{
      z: string
      y: string
    }>()
    expect(path).toBe('/prefix/suffix?y=2&z=3')
    const path1 = route1.get()
    const pathHash1 = route1.get({ '#': 'zxc' })
    expect(path1).toBe('/prefix/suffix')
    expect(pathHash1).toBe('/prefix/suffix#zxc')
  })

  it('extend with params and typed search', () => {
    const route0 = Route0.create('/prefix/:id').search<{ y: string; z: string }>()
    const route1 = route0.extend('/:sn/suffix')
    const path = route1.get({ id: 'myid', sn: 'mysn', '?': { y: '2', z: '3' } })
    expectTypeOf<(typeof route1)['Infer']['SearchInput']>().toEqualTypeOf<{
      z: string
      y: string
    }>()
    expect(path).toBe('/prefix/myid/mysn/suffix?y=2&z=3')
    const path1 = route1.get({ id: 'myid', sn: 'mysn' })
    const pathHash1 = route1.get({ id: 'myid', sn: 'mysn', '#': 'zxc' })
    expect(path1).toBe('/prefix/myid/mysn/suffix')
    expect(pathHash1).toBe('/prefix/myid/mysn/suffix#zxc')
  })

  it('extend with params and typed search, callable', () => {
    // const route0 = Route0.create('/prefix/:id&y&z')
    // const route1 = route0.extend('/:sn/suffix&z&c')
    // const path = route1({ id: 'myid', sn: 'mysn', '?': { y: '2', c: '3', a: '4' } })
    // expectTypeOf<(typeof route1)['searchDefinition']>().toEqualTypeOf<{
    //   z: true
    //   c: true
    // }>()
    // expect(path).toBe('/prefix/myid/mysn/suffix?y=2&c=3&a=4')
    // const path1 = route1({ id: 'myid', sn: 'mysn' })
    // expect(path1).toBe('/prefix/myid/mysn/suffix')
    // const pathHash1 = route1({ id: 'myid', sn: 'mysn', '#': 'zxc' })
    // expect(pathHash1).toBe('/prefix/myid/mysn/suffix#zxc')
  })

  it('abs default throw if no window.location.origin', () => {
    const route0 = Route0.create('/path')
    expect(() => route0.get(undefined, { origin: true })).toThrow()
    expect(() => route0.abs()).toThrow()
  })

  it('origin as string not throw if no window.location.origin', () => {
    const route0 = Route0.create('/path')
    const path = route0.get(undefined, { origin: 'https://example.com' })
    expect(path).toBe('https://example.com/path')
    expect(route0.abs(undefined, { origin: 'https://example.com' })).toBe('https://example.com/path')
  })

  it('origin as string not throw if no window.location.origin and not used additional path', () => {
    const route0 = Route0.create('/path')
    const path = route0.get(undefined, { origin: 'https://example.com/x' })
    expect(path).toBe('https://example.com/path')
  })

  it('abs default set window.location.origin', () => {
    ;(globalThis as unknown as { location?: { origin?: string } }).location = { origin: 'https://example.com' }
    const route0 = Route0.create('/path')
    const path = route0.abs()
    const pathHash = route0.get({ '#': 'zxc' }, { origin: true })
    expect(path).toBe('https://example.com/path')
    expect(path).toBe(route0.get({}, { origin: true }))
    expect(pathHash).toBe('https://example.com/path#zxc')
    expect(pathHash).toBe(route0.abs({ '#': 'zxc' }))
    delete (globalThis as unknown as { location?: unknown }).location
  })

  it('abs set', () => {
    const route0 = Route0.create('/path', { origin: 'https://x.com' })
    const path = route0.abs()
    const pathHash = route0.get({ '#': 'zxc' }, { origin: true })
    expect(path).toBe('https://x.com/path')
    expect(path).toBe(route0.get({}, { origin: true }))
    expect(pathHash).toBe('https://x.com/path#zxc')
    expect(pathHash).toBe(route0.abs({ '#': 'zxc' }))
  })

  it('abs override', () => {
    const route0 = Route0.create('/path', { origin: 'https://x.com' })
    route0.origin = 'https://y.com'
    const path = route0.abs()
    const pasthHash = route0.get({ '#': 'zxc' }, { origin: true })
    expect(path).toBe('https://y.com/path')
    expect(path).toBe(route0.get({}, { origin: true }))
    expect(pasthHash).toBe('https://y.com/path#zxc')
    expect(pasthHash).toBe(route0.abs({ '#': 'zxc' }))
  })

  it('abs override extend', () => {
    const route0 = Route0.create('/path', { origin: 'https://x.com' })
    route0.origin = 'https://y.com'
    const route1 = route0.extend('/suffix')
    const path = route1.abs()
    const pathHash = route1.get({ '#': 'zxc' }, { origin: true })
    expect(path).toBe('https://y.com/path/suffix')
    expect(path).toBe(route1.get({}, { origin: true }))
    expect(pathHash).toBe('https://y.com/path/suffix#zxc')
    expect(pathHash).toBe(route1.abs({ '#': 'zxc' }))
  })

  it('abs with explicit origin override option', () => {
    const route0 = Route0.create('/path', { origin: 'https://x.com' })
    expect(route0.abs(undefined, { origin: 'https://z.com' })).toBe('https://z.com/path')
    // abs can be forced back to relative
    expect(route0.abs(undefined, { origin: false })).toBe('/path')
  })

  it('encode: false emits a human-readable path and search', () => {
    const route0 = Route0.create('/files/:name')
    // default encodes path params and search values
    expect(route0.get({ name: 'a b/c' })).toBe('/files/a%20b%2Fc')
    expect(route0.get({ name: 'x', '?': { q: 'a b' } })).toBe('/files/x?q=a%20b')
    // encode: false leaves both raw
    expect(route0.get({ name: 'a b/c' }, { encode: false })).toBe('/files/a b/c')
    expect(route0.get({ name: 'x', '?': { q: 'a b' } }, { encode: false })).toBe('/files/x?q=a b')
    // encode applies to abs() too
    const abs = Route0.create('/files/:name', { origin: 'https://x.com' })
    expect(abs.abs({ name: 'a b' }, { encode: false })).toBe('https://x.com/files/a b')
  })

  // it('abs override many', () => {
  //   const route0 = Route0.create('/path', { origin: 'https://x.com' })
  //   const route1 = route0.extend('/suffix')
  //   const routes = {
  //     r0: route0,
  //     r1: route1,
  //   }
  //   const routes2 = Route0._.overrideMany(routes, { origin: 'https://z.com' })
  //   const path = routes2.r1.get({ abs: true })
  //   expectTypeOf<typeof path>().toEqualTypeOf<`${string}/path/suffix`>()
  //   expect(path).toBe('https://z.com/path/suffix')
  // })

  it('type errors: require params when defined', () => {
    const rWith = Route0.create('/a/:id', { origin: 'https://example.com' })
    // @ts-expect-error missing required path params
    expect(rWith.get()).toBe('/a/undefined')

    // @ts-expect-error missing required path params
    expect(rWith.get({})).toBe('/a/undefined')
    // @ts-expect-error missing required path params (object form abs)
    expect(rWith.get(undefined, { origin: true })).toBe('https://example.com/a/undefined')
    // @ts-expect-error missing required path params (object form search)
    expect(rWith.get({ '?': { q: '1' } })).toBe('/a/undefined?q=1')

    // @ts-expect-error params can not be sent as object value it should be argument
    rWith.get({ params: { id: '1' } }) // not throw becouse this will not used
    expect(rWith.get({ id: '1' })).toBe('/a/1')

    const rNo = Route0.create('/b')
    // @ts-expect-error no path params allowed for this route (shorthand)
    expect(rNo.get({ id: '1' })).toBe('/b')
  })

  it('really any route assignable to AnyRoute', () => {
    expectTypeOf<Route0<string>>().toExtend<AnyRoute>()
    expectTypeOf<Route0<string, { x: string }>>().toExtend<AnyRoute>()
    expectTypeOf<Route0<string>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<Route0<string, { x: string }>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<Route0<'/path'>>().toExtend<AnyRoute>()
    expectTypeOf<Route0<'/path', { x: string }>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<Route0<'/path/:id'>>().toExtend<AnyRoute>()
    expectTypeOf<Route0<'/path/:id', { x?: string }>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<CallableRoute<'/path'>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<CallableRoute<'/path', { x: string }>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<CallableRoute<'/path'>>().toExtend<AnyRoute>()
    expectTypeOf<CallableRoute<'/path', { x: string }>>().toExtend<AnyRoute>()
    expectTypeOf<CallableRoute<'/path/:id'>>().toExtend<AnyRoute>()
    expectTypeOf<CallableRoute<'/path/:id', { x?: string }>>().toExtend<AnyRoute>()
    expectTypeOf<CallableRoute<'/path/:id'>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<CallableRoute<'/path/:id', { x?: string }>>().toExtend<AnyRouteOrDefinition>()
    expectTypeOf<CallableRoute>().toExtend<AnyRoute>()
    expectTypeOf<CallableRoute>().toExtend<AnyRouteOrDefinition>()

    const route = Route0.create('/path')
    expectTypeOf<typeof route>().toExtend<AnyRoute>()
    expectTypeOf<typeof route>().toExtend<AnyRouteOrDefinition>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const route2 = route.extend('/path2')
    expectTypeOf<typeof route2>().toExtend<AnyRoute>()
    expectTypeOf<typeof route2>().toExtend<AnyRouteOrDefinition>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const route3 = route.extend('/path3').search<{ x: string }>()
    expectTypeOf<typeof route3>().toExtend<AnyRoute>()
    expectTypeOf<typeof route3>().toExtend<AnyRouteOrDefinition>()

    // Test that specific CallableRoute with literal path IS assignable to AnyRouteOrDefinition
    expectTypeOf<CallableRoute<'/ideas/best'>>().toExtend<AnyRouteOrDefinition>()

    // Test actual function parameter assignment scenario
    const testFn = (_route: AnyRouteOrDefinition) => {
      // intentionally empty
    }
    const callableRoute = Route0.create('/ideas/best')
    testFn(callableRoute) // This should work

    // Test with params
    const routeWithParams = Route0.create('/ideas/:id')
    testFn(routeWithParams) // This should also work
  })

  it('CallableRoute distributes over a definitions union', () => {
    // A union definition must produce a union of per-route callables, NOT (Route0<A> | Route0<B>) & (getA | getB):
    // that intersection normalizes as a cross-product — N routes → N² union members — and a routes map with a few
    // hundred entries indexed by a generic key (e.g. a typed navigate(name, input)) trips TS2590.
    expectTypeOf<CallableRoute<'/a' | '/b/:id'>>().toEqualTypeOf<CallableRoute<'/a'> | CallableRoute<'/b/:id'>>()
    expectTypeOf<CallableRoute<'/a'>>().toEqualTypeOf<AnyRoute<'/a'> & AnyRoute<'/a'>['get']>()
  })

  it('clone, from, create', () => {
    const route = Route0.create('/path')
    const clonedRoute = route.clone()
    expect(clonedRoute.get()).toBe('/path')
    expect(clonedRoute).not.toBe(route)
    expect(clonedRoute.definition).toBe(route.definition)

    const createdRoute = Route0.create(route)
    expect(createdRoute.get()).toBe('/path')
    expect(createdRoute).not.toBe(route)
    expect(createdRoute.definition).toBe(route.definition)

    const fromRoute = Route0.from(route)
    expect(fromRoute.get()).toBe('/path')
    expect(fromRoute).toBe(route)
    expect(fromRoute.definition).toBe(route.definition)
  })

  it('Route0.from preserves definition for strings and routes', () => {
    const a = Route0.create('/')
    const b = a.extend('/b')
    const c = b.extend('/:c')
    const d = c.extend('/x')
    expect(Route0.from(a.definition).definition).toBe('/')
    expect(Route0.from(b.definition).definition).toBe('/b')
    expect(Route0.from(c.definition).definition).toBe('/b/:c')
    expect(Route0.from(d.definition).definition).toBe('/b/:c/x')
    expect(Route0.from('/').definition).toBe('/')
    expect(Route0.from('/b').definition).toBe('/b')
    expect(Route0.from('/b/:c').definition).toBe('/b/:c')
    expect(Route0.from('/b/:c/x').definition).toBe('/b/:c/x')
  })
})

describe('type utilities', () => {
  it('HasParams', () => {
    expectTypeOf<HasParams<'/path'>>().toEqualTypeOf<false>()
    expectTypeOf<HasParams<'/path/:id'>>().toEqualTypeOf<true>()
    expectTypeOf<HasParams<'/path/:id/:name'>>().toEqualTypeOf<true>()

    expectTypeOf<HasParams<Route0<'/path'>>>().toEqualTypeOf<false>()
    expectTypeOf<HasParams<Route0<'/path/:id'>>>().toEqualTypeOf<true>()
  })

  it('HasWildcard', () => {
    expectTypeOf<HasWildcard<'/path'>>().toEqualTypeOf<false>()
    expectTypeOf<HasWildcard<'/path*'>>().toEqualTypeOf<true>()
    expectTypeOf<HasWildcard<'/path/*?'>>().toEqualTypeOf<true>()
    expectTypeOf<HasWildcard<'/path/:id'>>().toEqualTypeOf<false>()

    expectTypeOf<HasWildcard<Route0<'/path'>>>().toEqualTypeOf<false>()
    expectTypeOf<HasWildcard<Route0<'/path*'>>>().toEqualTypeOf<true>()
    expectTypeOf<HasWildcard<Route0<'/orders/*?'>>>().toEqualTypeOf<true>()
  })

  it('ParamsInput', () => {
    expectTypeOf<ParamsInput<'/path'>>().toEqualTypeOf<Record<never, never>>()
    expectTypeOf<ParamsInput<'/path/:id'>>().toEqualTypeOf<{ id: string | number }>()
    expectTypeOf<ParamsInput<'/path/:id/:name'>>().toEqualTypeOf<{ id: string | number; name: string | number }>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const route = Route0.create('/path/:id/:name')
    expectTypeOf<ParamsInput<typeof route>>().toEqualTypeOf<{ id: string | number; name: string | number }>()
  })

  it('ParamsOutput', () => {
    expectTypeOf<ParamsOutput<'/path/:id'>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<ParamsOutput<'/path/:id/:name'>>().toEqualTypeOf<{ id: string; name: string }>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const route = Route0.create('/path/:id/:name')
    expectTypeOf<ParamsOutput<typeof route>>().toEqualTypeOf<{ id: string; name: string }>()
  })

  it('ParamsInputStringOnly', () => {
    expectTypeOf<ParamsInputStringOnly<'/path'>>().toEqualTypeOf<Record<never, never>>()
    expectTypeOf<ParamsInputStringOnly<'/path/:id'>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<ParamsInputStringOnly<'/path/:id/:name'>>().toEqualTypeOf<{ id: string; name: string }>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const route = Route0.create('/path/:id/:name')
    expectTypeOf<ParamsInputStringOnly<typeof route>>().toEqualTypeOf<{ id: string; name: string }>()
  })

  it('GetPathInputByRoute infers params for route and callable route', () => {
    expectTypeOf<GetPathInputByRoute<Route0<'/users/:id/:slug?'>>>().toEqualTypeOf<
      GetPathInput<'/users/:id/:slug?', UnknownSearchInput>
    >()

    expectTypeOf<GetPathInputByRoute<CallableRoute<'/users/:id/:slug?'>>>().toEqualTypeOf<
      GetPathInput<'/users/:id/:slug?', UnknownSearchInput>
    >()
    expectTypeOf<GetPathInputByRoute<CallableRoute<Route0<'/users/:id/:slug?'>>>>().toEqualTypeOf<
      GetPathInput<'/users/:id/:slug?', UnknownSearchInput>
    >()

    expectTypeOf<GetPathInputByRoute<'/users/:id/:slug?'>>().toEqualTypeOf<
      GetPathInput<'/users/:id/:slug?', UnknownSearchInput>
    >()

    // // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // const route = Route0.create('/users/:id/:slug?').search<{ q: string }>()

    // type X = GetPathInputByRoute<typeof route>

    // expectTypeOf<X>().toEqualTypeOf<{
    //   id: string | number
    //   slug?: string | number
    //   '?'?: { q: string } | undefined
    //   '#'?: string | number | undefined
    // }>()
  })

  it('IsParamsOptional', () => {
    type T1 = IsParamsOptional<'/path'>
    expectTypeOf<T1>().toEqualTypeOf<true>()
    type T2 = IsParamsOptional<'/path/:id'>
    expectTypeOf<T2>().toEqualTypeOf<false>()
    type T3 = IsParamsOptional<'/path'>
    expectTypeOf<T3>().toEqualTypeOf<true>()
    type T4 = IsParamsOptional<'/path/:id'>
    expectTypeOf<T4>().toEqualTypeOf<false>()
    type T5 = IsParamsOptional<'/path/:id?'>
    expectTypeOf<T5>().toEqualTypeOf<true>()
    type T6 = IsParamsOptional<'/path*'>
    expectTypeOf<T6>().toEqualTypeOf<false>()
    type T7 = IsParamsOptional<'/path*?'>
    expectTypeOf<T7>().toEqualTypeOf<true>()
  })

  // it('IsAncestor', () => {
  //   type T1 = IsAncestor<'/path/child', '/path'>
  //   type T2 = IsAncestor<'/path', '/path/child'>
  //   type T3 = IsAncestor<'/other', '/path'>
  //   type T4 = IsAncestor<'/path', '/path'>
  //   expectTypeOf<T1>().toEqualTypeOf<true>()
  //   expectTypeOf<T2>().toEqualTypeOf<false>()
  //   expectTypeOf<T3>().toEqualTypeOf<false>()
  //   expectTypeOf<T4>().toEqualTypeOf<false>()
  // })

  // it('IsDescendant', () => {
  //   type T1 = IsDescendant<'/path', '/path/child'>
  //   type T2 = IsDescendant<'/path/child', '/path'>
  //   type T3 = IsDescendant<'/path', '/other'>
  //   type T4 = IsDescendant<'/path', '/path'>
  //   expectTypeOf<T1>().toEqualTypeOf<true>()
  //   expectTypeOf<T2>().toEqualTypeOf<false>()
  //   expectTypeOf<T3>().toEqualTypeOf<false>()
  //   expectTypeOf<T4>().toEqualTypeOf<false>()
  // })

  // it('IsSame', () => {
  //   type T1 = IsSame<'/path', '/path'>
  //   type T2 = IsSame<'/path', '/path/child'>
  //   type T3 = IsSame<'/path/child', '/path'>
  //   expectTypeOf<T1>().toEqualTypeOf<true>()
  //   expectTypeOf<T2>().toEqualTypeOf<false>()
  //   expectTypeOf<T3>().toEqualTypeOf<false>()
  // })

  it('IsSameParams', () => {
    type T1 = IsSameParams<'/path', '/other'>
    type T2 = IsSameParams<'/path/:id', '/other/:id'>
    type T3 = IsSameParams<'/path/:id', '/other'>
    type T4 = IsSameParams<'/path/:id', '/other/:name'>
    expectTypeOf<T1>().toEqualTypeOf<true>()
    expectTypeOf<T2>().toEqualTypeOf<true>()
    expectTypeOf<T3>().toEqualTypeOf<false>()
    expectTypeOf<T4>().toEqualTypeOf<false>()
  })

  it('Extended', () => {
    expectTypeOf<Extended<'/path', '/child'>>().toEqualTypeOf<Route0<'/path/child'>>()
    expectTypeOf<Extended<'/path', '/:id'>>().toEqualTypeOf<Route0<'/path/:id'>>()
    expectTypeOf<Extended<'/path', '', { x: string; y: string }>>().toEqualTypeOf<
      Route0<'/path', { x: string; y: string }>
    >()
    expectTypeOf<Extended<'/path/:id', '/child', { x: string }>>().toEqualTypeOf<
      Route0<'/path/:id/child', { x: string }>
    >()
    expectTypeOf<Extended<undefined, '/path', { x: string }>>().toEqualTypeOf<Route0<'/path', { x: string }>>()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ancestor = Route0.create('/path')
    expectTypeOf<Extended<typeof ancestor, '/child'>>().toEqualTypeOf<Route0<'/path/child'>>()
  })
})

describe('getLocation', () => {
  describe('Route0', () => {
    it('.getLocation location of url', () => {
      let loc = Route0.getLocation('/prefix/some/suffix')
      expect(loc).toMatchObject({
        hash: '',
        href: undefined,
        hrefRel: '/prefix/some/suffix',
        abs: false,
        origin: undefined,
        params: undefined,
        pathname: '/prefix/some/suffix',
        search: {},
        searchString: '',
      })
      loc = Route0.getLocation('/prefix/some/suffix?x=1&z=2')
      expect(loc).toMatchObject({
        hash: '',
        href: undefined,
        hrefRel: '/prefix/some/suffix?x=1&z=2',
        abs: false,
        origin: undefined,
        params: undefined,
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
      loc = Route0.getLocation('https://example.com/prefix/some/suffix?x=1&z=2')
      expect(loc).toMatchObject({
        hash: '',
        href: 'https://example.com/prefix/some/suffix?x=1&z=2',
        hrefRel: '/prefix/some/suffix?x=1&z=2',
        abs: true,
        origin: 'https://example.com',
        params: undefined,
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
    })

    it('.getLocation parses deep search object and array', () => {
      const path = '/search?filter[status]=open&filter[meta][page]=2&tags[]=a&tags[]=b'
      const locSimple = Route0.getLocation(path)
      const locEncoded = Route0.getLocation(encodeURI(path))
      const expected = {
        pathname: '/search',
        search: {
          filter: {
            status: 'open',
            meta: { page: '2' },
          },
          tags: ['a', 'b'],
        },
      }
      expect(locSimple).toMatchObject(expected)
      expect(locEncoded).toMatchObject(expected)
    })

    it('.getLocation parses triple-nested search params', () => {
      const path = '/p?a[b][c][d]=deep'
      const locSimple = Route0.getLocation(path)
      const locEncoded = Route0.getLocation(encodeURI(path))
      const expected = { a: { b: { c: { d: 'deep' } } } }
      expect(locSimple.search).toEqual(expected)
      expect(locEncoded.search).toEqual(expected)
    })

    it('.getLocation parses mixed nested objects and arrays', () => {
      const path =
        '/p?form[fields][0][name]=email&form[fields][0][type]=text&form[fields][1][name]=age&form[fields][1][type]=number&form[submit]=true'
      const locSimple = Route0.getLocation(path)
      const locEncoded = Route0.getLocation(encodeURI(path))
      const expected = {
        form: {
          fields: [
            { name: 'email', type: 'text' },
            { name: 'age', type: 'number' },
          ],
          submit: 'true',
        },
      }
      expect(locSimple.search).toEqual(expected)
      expect(locEncoded.search).toEqual(expected)
    })

    it('.getLocation parses nested array of primitives (indexed)', () => {
      const path = '/p?ids[0]=10&ids[1]=20&ids[2]=30'
      const locSimple = Route0.getLocation(path)
      const locEncoded = Route0.getLocation(encodeURI(path))
      const expected = { ids: ['10', '20', '30'] }
      expect(locSimple.search).toEqual(expected)
      expect(locEncoded.search).toEqual(expected)
    })

    it('.getLocation parses nested array of primitives (non-indexed)', () => {
      const path = '/p?ids[]=10&ids[]=20&ids[]=30'
      const locSimple = Route0.getLocation(path)
      const locEncoded = Route0.getLocation(encodeURI(path))
      const expected = { ids: ['10', '20', '30'] }
      expect(locSimple.search).toEqual(expected)
      expect(locEncoded.search).toEqual(expected)
    })

    it('.getLocation search is lazily computed', () => {
      const loc = Route0.getLocation('/users/123?x=1')
      expect(loc.pathname).toBe('/users/123')
      expect(loc.searchString).toBe('?x=1')
      expect(loc.search).toEqual({ x: '1' })
      expect(loc.search).toBe(loc.search)
    })

    it('.toRelLocation', () => {
      const loc = Route0.toRelLocation(Route0.getLocation('https://example.com/prefix/some/suffix?x=1&z=2'))
      expect(loc).toMatchObject({
        hash: '',
        href: undefined,
        hrefRel: '/prefix/some/suffix?x=1&z=2',
        abs: false,
        origin: undefined,
        params: undefined,
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
      const sameLoc = Route0.toRelLocation(loc)
      expect(sameLoc).toMatchObject(loc)
    })

    it('.toAbsLocation', () => {
      const loc = Route0.toRelLocation(Route0.getLocation('https://example.com/prefix/some/suffix?x=1&z=2'))
      const absLoc = Route0.toAbsLocation(loc, 'https://example2.com')
      expect(absLoc).toMatchObject({
        hash: '',
        href: 'https://example2.com/prefix/some/suffix?x=1&z=2',
        hrefRel: '/prefix/some/suffix?x=1&z=2',
        abs: true,
        origin: 'https://example2.com',
        params: undefined,
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
      const sameLoc = Route0.toRelLocation(loc)
      expect(sameLoc).toMatchObject(loc)
    })

    it('.getLocation() with host info', () => {
      const loc = Route0.getLocation('https://example.com:8080/path')
      expect(loc.params).toBeUndefined()
      expect(loc.origin).toBe('https://example.com:8080')
      expect(loc.host).toBe('example.com:8080')
      expect(loc.hostname).toBe('example.com')
      expect(loc.port).toBe('8080')
    })

    it('.getLocation() with hash', () => {
      const loc = Route0.getLocation('/path/123#section')
      expect(loc.hash).toBe('#section')
      expect(loc.pathname).toBe('/path/123')
    })

    it('.getLocation accepts URL instance (absolute)', () => {
      const url = new URL('https://example.com/prefix/some/suffix?x=1&z=2#hash')
      const loc = Route0.getLocation(url)
      expect(loc).toMatchObject({
        hash: '#hash',
        href: 'https://example.com/prefix/some/suffix?x=1&z=2#hash',
        hrefRel: '/prefix/some/suffix?x=1&z=2#hash',
        abs: true,
        origin: 'https://example.com',
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
    })

    it('.getLocation accepts URL instance (relative with base)', () => {
      const url = new URL('/prefix/some/suffix?x=1&z=2', 'https://example.com')
      const loc = Route0.getLocation(url)
      expect(loc).toMatchObject({
        hash: '',
        href: 'https://example.com/prefix/some/suffix?x=1&z=2',
        hrefRel: '/prefix/some/suffix?x=1&z=2',
        abs: true,
        origin: 'https://example.com',
        pathname: '/prefix/some/suffix',
        search: { x: '1', z: '2' },
        searchString: '?x=1&z=2',
      })
    })

    it('.getLocation from empty string has / pathname', () => {
      const loc = Route0.getLocation('')
      console.log(loc)
      expect(loc).toMatchObject({
        pathname: '/',
        search: {},
        searchString: '',
        hash: '',
        origin: undefined,
        href: undefined,
        hrefRel: '/',
        abs: false,
        host: undefined,
        hostname: undefined,
        port: undefined,
        params: undefined,
        route: undefined,
      })
    })
  })

  describe('Routes', () => {
    it('types helpers', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const routes = Routes.create({
        home: '/',
        users: '/users',
        userDetail: Route0.create('/users/:id'),
      })
      expectTypeOf<ExtractRoutesKeys<typeof routes>>().toEqualTypeOf<'home' | 'users' | 'userDetail'>()
      expectTypeOf<ExtractRoute<typeof routes, 'userDetail'>>().toEqualTypeOf<CallableRoute<'/users/:id'>>()
      expectTypeOf<ExtractRoutesKeys<RoutesPretty>>().toEqualTypeOf<string>()
    })

    it('exact match returns ExactLocation', () => {
      const routes = Routes.create({
        home: '/',
        users: '/users',
        userDetail: Route0.create('/users/:id'),
      })

      expectTypeOf<(typeof routes)['home']>().toEqualTypeOf<CallableRoute<'/'>>()
      expectTypeOf<(typeof routes)['userDetail']>().toEqualTypeOf<CallableRoute<'/users/:id'>>()
      const loc = routes._.getLocation('/users/123')
      expect(loc.route).toBeDefined()
      expect(loc.params).toBeDefined()
      expect(loc.pathname).toBe('/users/123')
      expect(loc.route).toBe(routes.userDetail.definition)
      if (loc.params) {
        expect(loc.params).toMatchObject({ id: '123' })
      }
    })

    it('no exact match returns UnknownLocation (ancestor case)', () => {
      const routes = Routes.create({
        home: '/',
        users: '/users',
        userDetail: '/users/:id',
      })

      // '/users/123/posts' is not an exact match for any route
      const loc = routes._.getLocation('/users/123/posts')
      expect(loc.route).toBeUndefined()
      expect(loc.params).toBeUndefined()
      expect(loc.pathname).toBe('/users/123/posts')
    })

    it('no exact match returns UnknownLocation (descendant case)', () => {
      const routes = Routes.create({
        home: '/',
        users: '/users',
        userDetail: '/users/:id/posts',
      })

      // '/users/123' is not an exact match for any route
      const loc = routes._.getLocation('/users/123')
      expect(loc.route).toBeUndefined()
      expect(loc.params).toBeUndefined()
      expect(loc.pathname).toBe('/users/123')
    })

    it('no match returns UnknownLocation', () => {
      const routes = Routes.create({
        home: '/',
        users: '/users',
      })

      const loc = routes._.getLocation('/posts/123')
      expect(loc.route).toBeUndefined()
      expect(loc.pathname).toBe('/posts/123')
      expect(loc.params).toBeUndefined()
    })

    it('matches most specific route', () => {
      const routes = Routes.create({
        userDetail: '/users/:id',
        userPosts: '/users/:id/posts',
        users: '/users',
      })

      // Should match /users exactly
      const loc1 = routes._.getLocation('/users')
      expect(loc1.params).toBeDefined()
      expect(loc1.pathname).toBe('/users')

      // Should match /users/:id exactly
      const loc2 = routes._.getLocation('/users/123')
      expect(loc2.params).toBeDefined()
      if (loc2.params) {
        expect(loc2.params).toMatchObject({ id: '123' })
      }

      // Should match /users/:id/posts exactly
      const loc3 = routes._.getLocation('/users/123/posts')
      expect(loc3.params).toBeDefined()
      if (loc3.params) {
        expect(loc3.params).toMatchObject({ id: '123' })
      }
    })

    it('with search params', () => {
      const routes = Routes.create({
        search: '/search',
        users: '/users',
      })

      const loc = routes._.getLocation('/search?q=test&filter=all')
      expect(loc.params).toBeDefined()
      expect(loc.pathname).toBe('/search')
      expect(loc.searchString).toBe('?q=test&filter=all')
      expect(loc.search).toMatchObject({ q: 'test', filter: 'all' })
    })

    it('with absolute URL', () => {
      const routes = Routes.create({
        api: '/api/v1',
        users: '/api/v1/users',
      })

      const loc = routes._.getLocation('https://example.com/api/v1/users')
      expect(loc.params).toBeDefined()
      expect(loc.abs).toBe(true)
      expect(loc.origin).toBe('https://example.com')
      expect(loc.pathname).toBe('/api/v1/users')
      expect(loc.href).toBe('https://example.com/api/v1/users')
    })

    it('with hash', () => {
      const routes = Routes.create({
        userDetail: '/users/:id',
      })

      const loc = routes._.getLocation('/users/123#profile')
      expect(loc.params).toBeDefined()
      expect(loc.hash).toBe('#profile')
      expect(loc.pathname).toBe('/users/123')
      if (loc.params) {
        expect(loc.params).toMatchObject({ id: '123' })
      }
    })

    it('with extended routes', () => {
      const api = Route0.create('/api/v1')
      const routes = Routes.create({
        api,
        users: api.extend('/users'),
        userDetail: api.extend('/users/:id'),
      })

      const loc = routes._.getLocation('/api/v1/users/456')
      expect(loc.params).toBeDefined()
      if (loc.params) {
        expect(loc.params).toMatchObject({ id: '456' })
      }
    })

    it('root route', () => {
      const routes = Routes.create({
        home: '/',
        about: '/about',
      })

      const loc = routes._.getLocation('/')
      expect(loc.params).toBeDefined()
      expect(loc.pathname).toBe('/')
    })

    it('with AnyLocation object as input', () => {
      const routes = Routes.create({
        userDetail: '/users/:id',
      })

      const inputLoc = Route0.getLocation('/users/789')
      const loc = routes._.getLocation(inputLoc)
      expect(loc.params).toBeDefined()
      if (loc.params) {
        expect(loc.params).toMatchObject({ id: '789' })
      }
    })

    it('complex routing with params and search', () => {
      const api = Route0.create('/api/v1')
      const routes = Routes.create({
        api,
        users: api.extend('/users'),
        userDetail: api.extend('/users/:id'),
        userPosts: api.extend('/users/:id/posts').search<{ sort: string; filter: string }>(),
      })

      const loc = routes._.getLocation('/api/v1/users/42/posts?sort=date&filter=published&extra=value')
      expect(loc.params).toBeDefined()
      expect(loc.pathname).toBe('/api/v1/users/42/posts')
      expect(loc.search).toMatchObject({
        sort: 'date',
        filter: 'published',
        extra: 'value',
      })
      if (loc.params) {
        expect(loc.params).toMatchObject({ id: '42' })
      }
    })

    it('resolves overlaps: static > required param > optional > wildcard', () => {
      const routes = Routes.create({
        usersStatic: '/users/new',
        usersRequired: '/users/:id',
        usersOptional: '/users/:id?',
        usersWildcard: '/users/*?',
      })

      const locStatic = routes._.getLocation('/users/new')
      expect(locStatic.params).toBeDefined()
      if (locStatic.params) {
        expect(locStatic.route).toBe('/users/new')
      }

      const locRequired = routes._.getLocation('/users/123')
      expect(locRequired.params).toBeDefined()
      if (locRequired.params) {
        expect(locRequired.route).toBe('/users/:id')
        expect(locRequired.params).toMatchObject({ id: '123' })
      }

      const locOptional = routes._.getLocation('/users')
      expect(locOptional.params).toBeDefined()
      if (locOptional.params) {
        expect(locOptional.route).toBe('/users/:id?')
      }

      const locWildcard = routes._.getLocation('/users/a/b/c')
      expect(locWildcard.params).toBeDefined()
      if (locWildcard.params) {
        expect(locWildcard.route).toBe('/users/*?')
      }
    })

    it('resolves app wildcard compatibility cases like wouter', () => {
      const routes = Routes.create({
        appRoot: '/app',
        appHome: '/app/home',
        appId: '/app/:id',
        appSplat: '/app*',
      })

      const m1 = routes._.getLocation('/app')
      expect(m1.params).toBeDefined()
      if (m1.params) expect(m1.route).toBe('/app')

      const m2 = routes._.getLocation('/app/home')
      expect(m2.params).toBeDefined()
      if (m2.params) expect(m2.route).toBe('/app/home')

      const m3 = routes._.getLocation('/app/123')
      expect(m3.params).toBeDefined()
      if (m3.params) expect(m3.route).toBe('/app/:id')

      const m4 = routes._.getLocation('/app-1')
      expect(m4.params).toBeDefined()
      if (m4.params) expect(m4.route).toBe('/app*')
    })

    it('resolves /path/x* and /path/x/* differently in Routes', () => {
      const routes = Routes.create({
        inlineWildcard: '/path/x*',
        segmentWildcard: '/path/x/*',
      })

      // '/path/x123' only matches inline wildcard.
      const a = routes._.getLocation('/path/x123')
      expect(a.params).toBeDefined()
      if (a.params) expect(a.route).toBe('/path/x*')

      // '/path/x/123' matches both, but '/path/x/*' should win as more specific.
      const b = routes._.getLocation('/path/x/123')
      expect(b.params).toBeDefined()
      if (b.params) expect(b.route).toBe('/path/x/*')

      // '/path/x' also matches both; segment wildcard remains preferred.
      const c = routes._.getLocation('/path/x')
      expect(c.params).toBeDefined()
      if (c.params) expect(c.route).toBe('/path/x/*')
    })

    it('uses fast pathname pre-check before full location parsing', () => {
      const routes = Routes.create({
        users: '/users/:id',
        posts: '/posts/:id',
      })

      const usersGetRelation = routes.users.getRelation.bind(routes.users)
      const postsGetRelation = routes.posts.getRelation.bind(routes.posts)
      let usersCalls = 0
      let postsCalls = 0

      routes.users.getRelation = ((...args) => {
        usersCalls += 1
        return usersGetRelation(...args)
      }) as typeof routes.users.getRelation
      routes.posts.getRelation = ((...args) => {
        postsCalls += 1
        return postsGetRelation(...args)
      }) as typeof routes.posts.getRelation

      const loc = routes._.getLocation('/users/123')
      expect(loc.params).toBeDefined()
      if (loc.params) {
        expect(loc.route).toBe('/users/:id')
      }
      expect(usersCalls).toBe(1)
      expect(postsCalls).toBe(0)
    })

    it('gets location for extended routes', () => {
      const a = Route0.create('/')
      const b = a.extend('/b')
      const c = b.extend('/:c')
      const d = c.extend('/x')
      const routes = Routes.create({
        a,
        b,
        c,
        d,
      })

      const loc = routes._.getLocation('/b/test')
      expect(loc.params).toBeDefined()
      expect(loc.route).toBe('/b/:c')
    })

    it('any RoutesPretty type suitable to any RoutesPretty type', () => {
      const routes = Routes.create({
        home: '/',
        v: '/b',
      }) satisfies RoutesPretty
      const fn = <T extends RoutesPretty>(routes: T) => {
        return routes
      }
      fn(routes)
    })

    it('throws in Routes.create when route has wildcard in middle', () => {
      expect(() =>
        Routes.create({
          invalid: '/a/*/b',
        }),
      ).toThrow('Invalid route definition "/a/*/b": wildcard segment is allowed only at the end')
    })
  })
})

describe('pathname relation checks', () => {
  it('isExact, isExactOrAncestor, isAncestor, isDescendant', () => {
    const route = Route0.create('/users/:id')

    expect(route.isExact('/users/123')).toBe(true)
    expect(route.isExact('/users/123/')).toBe(true)
    expect(route.isExact('/users/123/zxc')).toBe(false)
    expect(route.isExact('/users')).toBe(false)
    expect(route.isExact('/posts/123')).toBe(false)
    expect(route.isExactOrAncestor('/users/123')).toBe(true)
    expect(route.isExactOrAncestor('/users')).toBe(false)
    expect(route.isExactOrAncestor('/users/123/')).toBe(true)
    expect(route.isExactOrAncestor('/users/123/zxc')).toBe(true)
    expect(route.isExactOrAncestor('/posts/123')).toBe(false)
    expect(route.isExactOrAncestor('/posts/123/zxc')).toBe(false)
    expect(route.isAncestor('/users/123/zxc')).toBe(true)
    expect(route.isAncestor('/users/123')).toBe(false)
    expect(route.isDescendant('/users')).toBe(true)
    expect(route.isDescendant('/users/123')).toBe(false)
  })

  it('regex properties are cached (same reference)', () => {
    const route = Route0.create('/users/:id')
    expect(route.regex).toBe(route.regex)
    expect(route.regexString).toBe(route.regexString)
    expect(route.regexBaseString).toBe(route.regexBaseString)
  })

  it('isExact with root route', () => {
    const route = Route0.create('/')
    expect(route.isExact('/')).toBe(true)
    expect(route.isExact('/anything')).toBe(false)
  })

  it('isAncestor with root route', () => {
    const route = Route0.create('/')
    expect(route.isAncestor('/anything')).toBe(true)
    expect(route.isAncestor('/a/b/c')).toBe(true)
    expect(route.isAncestor('/')).toBe(false)
  })

  it('isDescendant with multi-segment route', () => {
    const route = Route0.create('/a/b/c')
    expect(route.isDescendant('/a')).toBe(true)
    expect(route.isDescendant('/a/b')).toBe(true)
    expect(route.isDescendant('/a/b/c')).toBe(false)
    expect(route.isDescendant('/a/b/c/d')).toBe(false)
    expect(route.isDescendant('/x')).toBe(false)
    // Root is not detected as ancestor by isDescendant -- descendant matchers
    // build patterns from route segment prefixes and don't special-case root.
    expect(route.isDescendant('/')).toBe(false)
  })

  it('isExact with wildcard routes', () => {
    const route = Route0.create('/app*')
    expect(route.isExact('/app')).toBe(true)
    expect(route.isExact('/app/home')).toBe(true)
    expect(route.isExact('/app-1')).toBe(true)
    expect(route.isExact('/other')).toBe(false)
  })

  it('normalize parameter skips normalization when false', () => {
    const route = Route0.create('/users/:id')
    expect(route.isExact('/users/123', false)).toBe(true)
    expect(route.isExact('/users/123/', false)).toBe(true)
  })
})

describe('params schema', () => {
  it('validate', () => {
    const route = Route0.create('/:id/:sn')
    const result = route.schema['~standard'].validate({ id: 1, sn: 'x', extra: 'ignored' })
    if (result instanceof Promise) {
      throw new Error('Unexpected async schema result')
    }
    expect(result).toMatchObject({
      value: { id: '1', sn: 'x' },
    })
  })

  it('parse and safeParse', () => {
    const route = Route0.create('/:id')
    expect(route.schema.parse({ id: 1, x: '2' })).toMatchObject({ id: '1' })
    expect(route.schema.safeParse(undefined)).toMatchObject({
      success: false,
      data: undefined,
      error: new Error('Missing params: "id"'),
    })
  })

  it('parse throws on missing required params', () => {
    const route = Route0.create('/:id')
    expect(() => route.schema.parse(undefined)).toThrow('Missing params: "id"')
    expect(() => route.schema.parse({})).toThrow('Missing params: "id"')
  })

  it('parse throws on invalid param types', () => {
    const route = Route0.create('/:id')
    expect(() => route.schema.parse({ id: true })).toThrow('Invalid route params')
    expect(() => route.schema.parse({ id: [] })).toThrow('Invalid route params')
    expect(() => route.schema.parse('string')).toThrow('Invalid route params')
  })

  it('safeParse returns success with coerced number values', () => {
    const route = Route0.create('/:id')
    const result = route.schema.safeParse({ id: 42 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toStrictEqual({ id: '42' })
    }
  })

  it('validate ignores extra keys and only picks defined params', () => {
    const route = Route0.create('/:id/:slug?')
    const result = route.schema['~standard'].validate({ id: 'abc', slug: 'hello', extra: 'ignored' })
    if (result instanceof Promise) throw new Error('Unexpected async')
    expect(result).toMatchObject({ value: { id: 'abc', slug: 'hello' } })
    expect(Object.keys((result as { value: Record<string, unknown> }).value)).toEqual(['id', 'slug'])
  })

  it('schema types are assignable to StandardSchemaV1', () => {
    const route = Route0.create('/:id')
    expectTypeOf(route.schema).toExtend<StandardSchemaV1>()
    expectTypeOf(route.schema).toExtend<StandardSchemaV1<ParamsInput<'/:id'>, ParamsOutput<'/:id'>>>()
    expectTypeOf(route.schema).toExtend<StandardJSONSchemaV1>()
    expectTypeOf(route.schema).toExtend<StandardJSONSchemaV1<ParamsInput<'/:id'>, ParamsOutput<'/:id'>>>()
  })

  it('exposes jsonSchema input/output converters', () => {
    const route = Route0.create('/:id/:slug?')
    const inputSchema = route.schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    const outputSchema = route.schema['~standard'].jsonSchema.output({ target: 'draft-07' })

    expect(inputSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        slug: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    })

    expect(outputSchema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
      },
    })
  })
})

describe('Routes', () => {
  it('create with string routes', () => {
    const collection = Routes.create({
      home: '/',
      about: '/about',
      contact: '/contact',
    })

    expect(collection).toBeInstanceOf(Routes)
    const home = collection.home
    const about = collection.about
    const contact = collection.contact

    expect(home).toBeInstanceOf(Route0)
    expect(about).toBeInstanceOf(Route0)
    expect(contact).toBeInstanceOf(Route0)

    expect(home.get()).toBe('/')
    expect(about.get()).toBe('/about')
    expect(contact.get()).toBe('/contact')
  })

  it('create with Route0 instances', () => {
    const homeRoute = Route0.create('/')
    const aboutRoute = Route0.create('/about')

    const collection = Routes.create({
      home: homeRoute,
      about: aboutRoute,
    })

    expect(collection.home.get()).toBe('/')
    expect(collection.about.get()).toBe('/about')
  })

  it('create with mixed string and Route0', () => {
    const aboutRoute = Route0.create('/about')

    const collection = Routes.create({
      home: '/',
      about: aboutRoute,
      contact: '/contact',
    })

    expect(collection.home.get()).toBe('/')
    expect(collection.about.get()).toBe('/about')
    expect(collection.contact.get()).toBe('/contact')
  })

  it('create with params and search', () => {
    const collection = Routes.create({
      user: '/user/:id',
      search: Route0.create('/search').search<{ q: string; filter: string }>(),
      userWithSearch: Route0.create('/user/:id').search<{ tab: string }>(),
    })
    const user = collection.user
    expect(user.get({ id: '123' })).toBe('/user/123')
    const search = collection.search
    expect(search.get({ '?': { q: 'test', filter: 'all' } })).toBe('/search?q=test&filter=all')
    const userWithSearch = collection.userWithSearch
    expect(userWithSearch.get({ id: '456', '?': { tab: 'posts' } })).toBe('/user/456?tab=posts')
    // @ts-expect-error invalid search param key
    expect(userWithSearch.get({ id: '456', '?': { zxc: 'posts' } })).toBe('/user/456?zxc=posts')
  })

  it('get maintains route definitions', () => {
    const collection = Routes.create({
      home: '/',
      user: '/user/:id',
    })

    const home = collection.home
    const user = collection.user

    // Verify route definitions are preserved
    expect(home.definition).toBe('/')
    expect(user.definition).toBe('/user/:id')

    // Verify params work correctly
    expect(user.get({ id: '123' })).toBe('/user/123')
  })

  it('clone with origin', () => {
    const collection = Routes.create({
      home: '/',
      about: '/about',
    })

    const overridden = collection._.clone({ origin: 'https://example.com' })

    const home = overridden.home
    const about = overridden.about

    expect(home.get(undefined, { origin: true })).toBe('https://example.com')
    expect(about.get(undefined, { origin: true })).toBe('https://example.com/about')
    expect(home.abs()).toBe('https://example.com')
    expect(about.abs()).toBe('https://example.com/about')
  })

  it('clone does not mutate original', () => {
    const collection = Routes.create(
      {
        home: '/',
      },
      { origin: 'https://example.com' },
    )

    const original = collection.home
    expect(original.get(undefined, { origin: true })).toBe('https://example.com')
    expect(original.abs()).toBe('https://example.com')

    const overridden = collection._.clone({ origin: 'https://newdomain.com' })
    const newRoute = overridden.home

    expect(original.get(undefined, { origin: true })).toBe('https://example.com')
    expect(newRoute.get(undefined, { origin: true })).toBe('https://newdomain.com')
    expect(newRoute.abs()).toBe('https://newdomain.com')
    expect(original.abs()).toBe('https://example.com')
  })

  it('clone with extended routes', () => {
    const apiRoute = Route0.create('/api', { origin: 'https://api.example.com' })
    const usersRoute = apiRoute.extend('/users')

    const collection = Routes.create({
      api: apiRoute,
      users: usersRoute,
    })

    expect(collection.api.get(undefined, { origin: true })).toBe('https://api.example.com/api')
    expect(collection.api(undefined, { origin: true })).toBe('https://api.example.com/api')
    expect(collection.users.get(undefined, { origin: true })).toBe('https://api.example.com/api/users')

    const overridden = collection._.clone({ origin: 'https://new-api.example.com' })

    expect(overridden.api.get(undefined, { origin: true })).toBe('https://new-api.example.com/api')
    expect(overridden.users.get(undefined, { origin: true })).toBe('https://new-api.example.com/api/users')
  })

  it('hydrate static method', () => {
    const hydrated = Routes._.hydrate({
      home: '/',
      user: '/user/:id',
      about: Route0.create('/about'),
    })

    expect(hydrated.home).toBeInstanceOf(Route0)
    expect(hydrated.user).toBeInstanceOf(Route0)
    expect(hydrated.about).toBeInstanceOf(Route0)

    expect(hydrated.home.get()).toBe('/')
    expect(hydrated.user.get({ id: '123' })).toBe('/user/123')
    expect(hydrated.about.get()).toBe('/about')
  })

  it('works with callable routes', () => {
    const collection = Routes.create({
      home: '/',
      user: '/user/:id',
    })

    const home = collection.home
    const user = collection.user

    // Routes should be callable
    expect(typeof home).toBe('function')
    expect(typeof user).toBe('function')
    expect(home()).toBe('/')
    expect(user({ id: '789' })).toBe('/user/789')
  })

  it('complex nested structure', () => {
    const api = Route0.create('/api/v1', { origin: 'https://api.example.com' })

    const collection = Routes.create({
      root: '/',
      api,
      users: api.extend('/users'),
      userDetail: api.extend('/users/:id'),
      userPosts: api.extend('/users/:id/posts').search<{ sort: string; filter: string }>(),
    })

    expect(collection.root.get()).toBe('/')
    expect(collection.api(undefined, { origin: true })).toBe('https://api.example.com/api/v1')
    expect(collection.users.get(undefined, { origin: true })).toBe('https://api.example.com/api/v1/users')

    const userDetailPath = collection.userDetail.get({ id: '42' }, { origin: true })
    expect(userDetailPath).toBe('https://api.example.com/api/v1/users/42')

    const userPostsPath = collection.userPosts.get(
      {
        id: '42',
        '?': { sort: 'date', filter: 'published' },
      },
      { origin: true },
    )
    expect(userPostsPath).toBe('https://api.example.com/api/v1/users/42/posts?sort=date&filter=published')
  })
})

describe('specificity', () => {
  it('isMoreSpecificThan: static vs param', () => {
    const static1 = Route0.create('/a/b')
    const param1 = Route0.create('/a/:id')

    expect(static1.isMoreSpecificThan(param1)).toBe(true)
    expect(param1.isMoreSpecificThan(static1)).toBe(false)
  })

  it('isMoreSpecificThan: more static segments wins', () => {
    const twoStatic = Route0.create('/a/b/c')
    const oneStatic = Route0.create('/a/:id/c')
    const noStatic = Route0.create('/a/:id/:name')

    expect(twoStatic.isMoreSpecificThan(oneStatic)).toBe(true)
    expect(oneStatic.isMoreSpecificThan(twoStatic)).toBe(false)

    expect(oneStatic.isMoreSpecificThan(noStatic)).toBe(true)
    expect(noStatic.isMoreSpecificThan(oneStatic)).toBe(false)

    expect(twoStatic.isMoreSpecificThan(noStatic)).toBe(true)
    expect(noStatic.isMoreSpecificThan(twoStatic)).toBe(false)
  })

  it('isMoreSpecificThan: compares overlapping segments then lexicographically', () => {
    const longer = Route0.create('/a/:id/b/:name')
    const shorter = Route0.create('/a/:id')

    // Both have same pattern for overlapping segments: static then param
    // Falls back to lexicographic: '/a/:id' < '/a/:id/b/:name'
    expect(longer.isMoreSpecificThan(shorter)).toBe(false)
    expect(shorter.isMoreSpecificThan(longer)).toBe(true)
  })

  it('isMoreSpecificThan: static at earlier position wins', () => {
    const route1 = Route0.create('/a/static/:param')
    const route2 = Route0.create('/a/:param/static')

    // Both have 2 static segments and same length
    // route1 has static at position 1, route2 has param at position 1
    expect(route1.isMoreSpecificThan(route2)).toBe(true)
    expect(route2.isMoreSpecificThan(route1)).toBe(false)
  })

  it('isMoreSpecificThan: lexicographic when completely equal', () => {
    const route1 = Route0.create('/aaa/:id')
    const route2 = Route0.create('/bbb/:id')

    // Same specificity, lexicographic comparison
    expect(route1.isMoreSpecificThan(route2)).toBe(true)
    expect(route2.isMoreSpecificThan(route1)).toBe(false)
  })

  it('isMoreSpecificThan: identical routes', () => {
    const route1 = Route0.create('/a/:id')
    const route2 = Route0.create('/a/:id')

    // Identical routes, lexicographic comparison returns false for equal strings
    expect(route1.isMoreSpecificThan(route2)).toBe(false)
    expect(route2.isMoreSpecificThan(route1)).toBe(false)
  })

  it('isMoreSpecificThan: root vs other routes', () => {
    const root = Route0.create('/')
    const other = Route0.create('/a')
    const param = Route0.create('/:id')

    // /a (1 static) vs / (1 static) - both static, lexicographic order
    expect(other.isMoreSpecificThan(root)).toBe(false) // '/' < '/a' lexicographically
    expect(root.isMoreSpecificThan(other)).toBe(true)

    // /a (1 static) vs /:id (0 static) - static beats param
    expect(other.isMoreSpecificThan(param)).toBe(true)
    expect(param.isMoreSpecificThan(other)).toBe(false)

    // /:id (0 static) vs / (1 static) - static beats param
    expect(param.isMoreSpecificThan(root)).toBe(false)
    expect(root.isMoreSpecificThan(param)).toBe(true)
  })

  it('isOverlap: checks if routes overlap', () => {
    const routeA = Route0.create('/a/:x')
    const routeB = Route0.create('/a/b')
    const routeC = Route0.create('/a/:c')
    const routeD = Route0.create('/a/d')
    const routeE = Route0.create('/a/b/c')

    // Same depth, can match
    expect(routeA.isOverlap(routeB)).toBe(true)
    expect(routeA.isOverlap(routeC)).toBe(true)
    expect(routeA.isOverlap(routeD)).toBe(true)
    expect(routeB.isOverlap(routeC)).toBe(true)

    // Different depth, no conflict
    expect(routeA.isOverlap(routeE)).toBe(false)
    expect(routeB.isOverlap(routeE)).toBe(false)
  })

  it('isOverlap: optional params overlap omitted and provided cases', () => {
    const optional = Route0.create('/users/:id?')
    expect(optional.isOverlap('/users')).toBe(true)
    expect(optional.isOverlap('/users/:name')).toBe(true)
  })

  it('isOverlap: optional params may not overlap deeper routes', () => {
    const optional = Route0.create('/users/:id?')
    expect(optional.isOverlap('/users/:id/posts')).toBe(false)
  })

  it('isOverlap: wildcard overlaps static, prefixed, and nested routes', () => {
    const wildcard = Route0.create('/app*')
    expect(wildcard.isOverlap('/app')).toBe(true)
    expect(wildcard.isOverlap('/app/home')).toBe(true)
    expect(wildcard.isOverlap('/app-home')).toBe(true)
  })

  it('isOverlap: optional segment wildcard overlaps base and nested routes', () => {
    const wildcard = Route0.create('/orders/*?')
    expect(wildcard.isOverlap('/orders')).toBe(true)
    expect(wildcard.isOverlap('/orders/history/2024')).toBe(true)
  })

  it('isOverlap: non-overlapping static and wildcard prefixes return false', () => {
    expect(Route0.create('/users').isOverlap('/posts')).toBe(false)
    expect(Route0.create('/api*').isOverlap('/app/:id')).toBe(false)
  })

  it('isOverlap: undefined returns false', () => {
    expect(Route0.create('/users').isOverlap(undefined)).toBe(false)
  })

  it('isConflict: same-language routes conflict', () => {
    expect(Route0.create('/x/:id').isConflict('/x/:sn')).toBe(true)
    expect(Route0.create('/users/:id?').isConflict('/users/:name?')).toBe(true)
  })

  it('isConflict: strict-subset overlap is not conflict', () => {
    expect(Route0.create('/x/:id').isConflict('/x/y')).toBe(false)
    expect(Route0.create('/users/*?').isConflict('/users/:id')).toBe(false)
  })

  it('isConflict: wildcard and param overlap is not conflict', () => {
    expect(Route0.create('/x/:id').isConflict('/x/*')).toBe(false)
    const routes = Routes.create({
      x: '/x/:id',
      y: '/x/*',
    })
    const ordered = routes._.ordered
    expect(ordered.length).toBe(2)
    expect(ordered[0].definition).toBe('/x/:id')
    expect(ordered[1].definition).toBe('/x/*')
  })

  it('isConflict: partial overlap is unresolvable conflict', () => {
    expect(Route0.create('/:x/:id').isConflict('/x/:sn?')).toBe(true)
  })

  it('isConflict: deeper static-prefixed route does not conflict with shallow param', () => {
    // overlap only at /users/impersonate, where the static "impersonate" is
    // uniformly more specific than ":sn", so ordering resolves it.
    expect(Route0.create('/users/impersonate/:id?').isConflict('/users/:sn')).toBe(false)
    expect(Route0.create('/users/:sn').isConflict('/users/impersonate/:id?')).toBe(false)
    const routes = Routes.create({
      impersonate: '/users/impersonate/:id?',
      detail: '/users/:sn',
    })
    expect(routes._.pathsOrdering).toEqual(['/users/impersonate/:id?', '/users/:sn'])
  })

  it('isConflict: non-overlapping routes are not conflict', () => {
    expect(Route0.create('/users').isConflict('/posts')).toBe(false)
  })

  it('isConflict: undefined returns false', () => {
    expect(Route0.create('/users').isConflict(undefined)).toBe(false)
  })
})

describe('regex', () => {
  it('regexString: simple route', () => {
    const route = Route0.create('/')
    const regex = route.regexString
    expect(regex).toBe('^/$')
    expect(new RegExp(regex).test('/')).toBe(true)
    expect(new RegExp(regex).test('/other')).toBe(false)
  })

  it('regexString: static route', () => {
    const route = Route0.create('/users')
    const regex = route.regexString
    expect(regex).toBe('^/users/?$')
    expect(new RegExp(regex).test('/users')).toBe(true)
    expect(new RegExp(regex).test('/users/123')).toBe(false)
  })

  it('regexString: route with single param', () => {
    const route = Route0.create('/users/:id')
    const regex = route.regexString
    expect(regex).toBe('^/users/([^/]+)/?$')
    expect(new RegExp(regex).test('/users/123')).toBe(true)
    expect(new RegExp(regex).test('/users/abc')).toBe(true)
    expect(new RegExp(regex).test('/users/123/posts')).toBe(false)
    expect(new RegExp(regex).test('/users')).toBe(false)
  })

  it('regexString: route with multiple params', () => {
    const route = Route0.create('/users/:userId/posts/:postId')
    const regex = route.regexString
    expect(regex).toBe('^/users/([^/]+)/posts/([^/]+)/?$')
    expect(new RegExp(regex).test('/users/123/posts/456')).toBe(true)
    expect(new RegExp(regex).test('/users/123/posts')).toBe(false)
  })

  it('regexString: route with special regex chars', () => {
    const route = Route0.create('/api/v1.0')
    const regex = route.regexString
    // The dot should be escaped
    expect(regex).toBe('^/api/v1\\.0/?$')
    expect(new RegExp(regex).test('/api/v1.0')).toBe(true)
    expect(new RegExp(regex).test('/api/v100')).toBe(false)
  })

  it('regexString: handles trailing slash', () => {
    const route = Route0.create('/users/')
    const regex = route.regexString
    // Trailing slash should be removed from pattern, but optional slash added in regex
    expect(regex).toBe('^/users/?$')
  })

  it('regexString: root with trailing slash', () => {
    const route = Route0.create('/')
    const regex = route.regexString
    // Root is strict and matches only "/"
    expect(regex).toBe('^/$')
  })

  it('regex: simple route', () => {
    const route = Route0.create('/users')
    const regex = route.regex
    expect(regex.test('/users')).toBe(true)
    expect(regex.test('/users/123')).toBe(false)
    expect(regex.test('/other')).toBe(false)
  })

  it('regex: route with params', () => {
    const route = Route0.create('/users/:id')
    const regex = route.regex
    expect(regex.test('/users/123')).toBe(true)
    expect(regex.test('/users/abc')).toBe(true)
    expect(regex.test('/users/123/posts')).toBe(false)
  })

  it('static getRegexString: multiple routes', () => {
    const routes = [Route0.create('/users'), Route0.create('/posts/:id'), Route0.create('/')]
    const regex = Route0.getRegexStringGroup(routes)
    expect(regex).toBe('^(?:(?:/users/?)|(?:/posts/([^/]+)/?)|(?:/))$')
  })

  it('static getRegexGroup: multiple routes', () => {
    const routes = [Route0.create('/users'), Route0.create('/posts/:id'), Route0.create('/')]
    const regex = Route0.getRegexGroup(routes)
    expect(regex.test('/users')).toBe(true)
    expect(regex.test('/posts/123')).toBe(true)
    expect(regex.test('/')).toBe(true)
    expect(regex.test('/other')).toBe(false)
  })

  it('static getRegexGroup: matches in order', () => {
    const routes = [Route0.create('/users/special'), Route0.create('/users/:id')]
    const regex = Route0.getRegexGroup(routes)
    const match = '/users/special'.match(regex)
    expect(match).toBeTruthy()
    // Both could match, but first one should win
    expect(match?.[0]).toBe('/users/special')
  })

  it('regexString works with getRelation', () => {
    const route = Route0.create('/users/:id/posts/:postId')
    const relation = route.getRelation('/users/123/posts/456')
    expect(relation.params).toStrictEqual({ id: '123', postId: '456' })
    expect(relation.params).toMatchObject({ id: '123', postId: '456' })
  })

  it('regex matches what getRelation uses', () => {
    const route = Route0.create('/api/:version/users/:id')
    const testPath = '/api/v1/users/42'

    // Test using getRelation
    const relation = route.getRelation(testPath)
    expect(relation.params).toStrictEqual({ version: 'v1', id: '42' })

    // Test using regex
    const regex = route.regex
    expect(regex.test(testPath)).toBe(true)
  })

  it('static getRegexGroup: complex routing scenario', () => {
    const api = Route0.create('/api/v1')
    const routes = [
      Route0.create('/'),
      api,
      api.extend('/users'),
      api.extend('/users/:id'),
      api.extend('/posts/:postId'),
      Route0.create('/:slug'),
    ]

    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/')).toBe(true)
    expect(regex.test('/api/v1')).toBe(true)
    expect(regex.test('/api/v1/users')).toBe(true)
    expect(regex.test('/api/v1/users/123')).toBe(true)
    expect(regex.test('/api/v1/posts/456')).toBe(true)
    expect(regex.test('/about')).toBe(true) // matches /:slug
    expect(regex.test('/api/v1/users/123/extra')).toBe(false)
  })

  it('regex: handles trailing slash correctly', () => {
    const route = Route0.create('/users')
    const regex = route.regex
    expect(regex.test('/users')).toBe(true)
    expect(regex.test('/users/')).toBe(true) // trailing slash should match
    expect(regex.test('/users//')).toBe(false) // double slash should not match
    expect(regex.test('/users/abc')).toBe(false) // additional segment should not match
  })

  it('regex: route with params and trailing slash', () => {
    const route = Route0.create('/users/:id')
    const regex = route.regex
    expect(regex.test('/users/123')).toBe(true)
    expect(regex.test('/users/123/')).toBe(true) // trailing slash should match
    expect(regex.test('/users/123/abc')).toBe(false) // additional segment should not match
    expect(regex.test('/users/')).toBe(false) // missing param
  })

  it('regex: root route edge cases', () => {
    const route = Route0.create('/')
    const regex = route.regex
    expect(regex.test('/')).toBe(true)
    expect(regex.test('')).toBe(false) // empty string is not a valid pathname
    expect(regex.test('//')).toBe(false) // double slash should not match
    expect(regex.test('/users')).toBe(false) // non-root should not match
  })

  it('regexString: handles multiple special regex characters', () => {
    const route1 = Route0.create('/api/v1.0')
    const route2 = Route0.create('/path(with)parens')
    const route3 = Route0.create('/path[with]brackets')
    const route5 = Route0.create('/path+with+pluses')
    const route6 = Route0.create('/path?with?question')
    const route7 = Route0.create('/path^with^caret')
    const route8 = Route0.create('/path$with$dollar')

    expect(route1.regexString).toBe('^/api/v1\\.0/?$')
    expect(route2.regexString).toBe('^/path\\(with\\)parens/?$')
    expect(route3.regexString).toBe('^/path\\[with\\]brackets/?$')
    expect(route5.regexString).toBe('^/path\\+with\\+pluses/?$')
    expect(route6.regexString).toBe('^/path\\?with\\?question/?$')
    expect(route7.regexString).toBe('^/path\\^with\\^caret/?$')
    expect(route8.regexString).toBe('^/path\\$with\\$dollar/?$')
  })

  it('asterisk is reserved wildcard token and not treated as literal static', () => {
    expect(() => Route0.create('/path*with*asterisks')).toThrow(
      'Invalid route definition "/path*with*asterisks": wildcard must be trailing in its segment',
    )
  })

  it('regex: works with escaped special characters', () => {
    const route = Route0.create('/api/v1.0/users')
    const regex = route.regex
    expect(regex.test('/api/v1.0/users')).toBe(true)
    expect(regex.test('/api/v1.0/users/')).toBe(true)
    expect(regex.test('/api/v100/users')).toBe(false) // dot must be literal
    expect(regex.test('/api/v1.0/users/extra')).toBe(false)
  })

  it('static getRegexGroup: handles routes with overlapping patterns', () => {
    const routes = [
      Route0.create('/users/special'),
      Route0.create('/users/:id'),
      Route0.create('/users/:id/edit'),
      Route0.create('/users'),
    ]
    const regex = Route0.getRegexGroup(routes)

    // Should match in order - first specific route wins
    expect(regex.test('/users/special')).toBe(true)
    expect(regex.test('/users/123')).toBe(true)
    expect(regex.test('/users/123/edit')).toBe(true)
    expect(regex.test('/users')).toBe(true)
    expect(regex.test('/users/special/extra')).toBe(false)
    expect(regex.test('/users/123/extra')).toBe(false)
  })

  it('static getRegexGroup: prevents partial matches', () => {
    const routes = [Route0.create('/api'), Route0.create('/api/v1'), Route0.create('/api/v1/users')]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/api')).toBe(true)
    expect(regex.test('/api/')).toBe(true)
    expect(regex.test('/api/v1')).toBe(true)
    expect(regex.test('/api/v1/')).toBe(true)
    expect(regex.test('/api/v1/users')).toBe(true)
    expect(regex.test('/api/v1/users/')).toBe(true)
    expect(regex.test('/api/v2')).toBe(false)
    expect(regex.test('/api/v1/users/123')).toBe(false) // should not match /api/v1/users
  })

  it('static getRegexGroup: handles root with other routes', () => {
    const routes = [Route0.create('/'), Route0.create('/home'), Route0.create('/about')]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/')).toBe(true)
    expect(regex.test('')).toBe(false)
    expect(regex.test('/home')).toBe(true)
    expect(regex.test('/about')).toBe(true)
    expect(regex.test('/other')).toBe(false)
  })

  it('static getRegexGroup: multiple routes with params', () => {
    const routes = [
      Route0.create('/posts/:id'),
      Route0.create('/users/:id'),
      Route0.create('/categories/:category/posts/:id'),
    ]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/posts/123')).toBe(true)
    expect(regex.test('/posts/123/')).toBe(true)
    expect(regex.test('/users/456')).toBe(true)
    expect(regex.test('/categories/tech/posts/789')).toBe(true)
    expect(regex.test('/posts/123/comments')).toBe(false)
    expect(regex.test('/users/456/posts')).toBe(false)
  })

  it('regex: prevents matching beyond route definition', () => {
    const route = Route0.create('/users/:id/posts/:postId')
    const regex = route.regex

    expect(regex.test('/users/1/posts/2')).toBe(true)
    expect(regex.test('/users/1/posts/2/')).toBe(true)
    expect(regex.test('/users/1/posts/2/comments')).toBe(false)
    expect(regex.test('/users/1/posts/2/comments/3')).toBe(false)
    expect(regex.test('/users/1/posts')).toBe(false)
    expect(regex.test('/users/1')).toBe(false)
  })

  it('static getRegexGroup: routes should not match partial segments', () => {
    const routes = [Route0.create('/admin'), Route0.create('/admin/users'), Route0.create('/admin/settings')]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/admin')).toBe(true)
    expect(regex.test('/admin/users')).toBe(true)
    expect(regex.test('/admin/settings')).toBe(true)
    expect(regex.test('/admin/users/123')).toBe(false) // /admin/users should not match longer paths
    expect(regex.test('/admins')).toBe(false) // should not match partial word
    expect(regex.test('/admin-extra')).toBe(false)
  })

  it('regex: handles consecutive slashes correctly', () => {
    const route = Route0.create('/users')
    const regex = route.regex

    expect(regex.test('/users')).toBe(true)
    expect(regex.test('/users/')).toBe(true)
    expect(regex.test('//users')).toBe(false) // double leading slash
    expect(regex.test('/users//')).toBe(false) // double trailing slash
    expect(regex.test('///users')).toBe(false) // triple slash
  })

  it('static getRegexGroup: handles very similar route patterns', () => {
    const routes = [
      Route0.create('/a/b'),
      Route0.create('/a/:param'),
      Route0.create('/a/b/c'),
      Route0.create('/a/b/:param'),
    ]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/a/b')).toBe(true)
    expect(regex.test('/a/xyz')).toBe(true) // matches /a/:param
    expect(regex.test('/a/b/c')).toBe(true)
    expect(regex.test('/a/b/xyz')).toBe(true) // matches /a/b/:param
    expect(regex.test('/a/b/c/d')).toBe(false)
  })

  it('regex: handles params with special characters', () => {
    const route = Route0.create('/users/:id')
    const regex = route.regex

    // Params should match URL-encoded characters
    expect(regex.test('/users/123')).toBe(true)
    expect(regex.test('/users/user-123')).toBe(true)
    expect(regex.test('/users/user_123')).toBe(true)
    expect(regex.test('/users/user.123')).toBe(true)
    expect(regex.test('/users/user%20123')).toBe(true) // URL encoded space
    expect(regex.test('/users/user%2F123')).toBe(true) // URL encoded slash (but this is a param value)
  })

  it('static getRegexGroup: ensures exact match boundaries', () => {
    const routes = [
      Route0.create('/test'),
      Route0.create('/testing'),
      Route0.create('/testing/:id'),
      Route0.create('/testing/:id/xxx'),
    ]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/test')).toBe(true)
    expect(regex.test('/test/')).toBe(true)
    expect(regex.test('/testing')).toBe(true)
    expect(regex.test('/testing/')).toBe(true)
    expect(regex.test('/testing/123')).toBe(true)
    expect(regex.test('/testing/123/xxx')).toBe(true)
    expect(regex.test('/test/ing')).toBe(false) // should not partially match
    expect(regex.test('/tested')).toBe(false) // should not match longer word
  })

  it('regexString: handles empty segments', () => {
    const route = Route0.create('/users//posts')
    const regex = route.regexString
    // Double slashes should be normalized to single slash
    expect(regex).toContain('/users')
    expect(regex).toContain('/posts')
  })

  it('static getRegexGroup: root route should not interfere with other routes', () => {
    const routes = [
      Route0.create('/'),
      Route0.create('/root'),
      Route0.create('/root/:id'),
      Route0.create('/root/:id/xxx'),
    ]
    const regex = Route0.getRegexGroup(routes)

    expect(regex.test('/')).toBe(true)
    expect(regex.test('')).toBe(false)
    expect(regex.test('/root')).toBe(true)
    expect(regex.test('/root/')).toBe(true)
    expect(regex.test('/rootx')).toBe(false)
    expect(regex.test('/root/123')).toBe(true)
    expect(regex.test('/root/123/xxx')).toBe(true)
    expect(regex.test('/root/123/yyy')).toBe(false)
    expect(regex.test('/rooting')).toBe(false)
  })
})

describe('normalizeSlash', () => {
  it('empty string becomes /', () => {
    expect(Route0.normalizeSlash('')).toBe('/')
  })

  it('single slash stays /', () => {
    expect(Route0.normalizeSlash('/')).toBe('/')
  })

  it('adds leading slash', () => {
    expect(Route0.normalizeSlash('users')).toBe('/users')
    expect(Route0.normalizeSlash('users/123')).toBe('/users/123')
  })

  it('removes trailing slash', () => {
    expect(Route0.normalizeSlash('/users/')).toBe('/users')
    expect(Route0.normalizeSlash('/users/123/')).toBe('/users/123')
  })

  it('collapses duplicate slashes', () => {
    expect(Route0.normalizeSlash('//users')).toBe('/users')
    expect(Route0.normalizeSlash('/users//123')).toBe('/users/123')
    expect(Route0.normalizeSlash('///a////b///')).toBe('/a/b')
  })

  it('handles all edge cases together', () => {
    expect(Route0.normalizeSlash('path/')).toBe('/path')
    expect(Route0.normalizeSlash('//path//')).toBe('/path')
    expect(Route0.normalizeSlash('////')).toBe('/')
  })
})

describe('ordering', () => {
  it('_makeOrdering: orders routes by specificity', () => {
    const routes = {
      root: '/',
      userDetail: '/users/:id',
      users: '/users',
      userPosts: '/users/:id/posts',
      catchAll: '/:slug',
    }

    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)

    // Pure specificity order (more specific first), so the param catch-all `/:slug` sinks below every static-prefixed
    // route it competes with. `/:slug` only overlaps the depth-1 routes (`/`, `/users`) and must lose to both.

    expect(ordering).toEqual(['/', '/users', '/users/:id', '/users/:id/posts', '/:slug'])
  })

  it('_makeOrdering: handles routes with same specificity', () => {
    const routes = {
      about: '/about',
      contact: '/contact',
      home: '/home',
    }

    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)

    // All have same depth and don't conflict
    // Ordered alphabetically
    expect(ordering).toEqual(['/about', '/contact', '/home'])
  })

  it('_makeOrdering: keeps concrete routes before wildcard overlaps', () => {
    const routes = {
      appWildcard: '/app*',
      appHome: '/app/home',
      app: '/app',
    }
    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)
    expect(ordering).toEqual(['/app', '/app/home', '/app*'])
  })

  it('_makeOrdering: mixed optional and required params are deterministic', () => {
    const routes = {
      usersOptional: '/users/:id?',
      usersRequired: '/users/:id',
      usersStatic: '/users/new',
      usersWildcard: '/users/*?',
    }
    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)
    expect(ordering.indexOf('/users/new')).toBeLessThan(ordering.indexOf('/users/:id'))
    expect(ordering.indexOf('/users/:id')).toBeLessThan(ordering.indexOf('/users/:id?'))
    expect(ordering.indexOf('/users/:id?')).toBeLessThan(ordering.indexOf('/users/*?'))
  })

  it('_makeOrdering: complex nested structure', () => {
    const api = Route0.create('/api/v1')
    const routes = {
      root: '/',
      api,
      usersStatic: '/api/v1/users/all',
      users: api.extend('/users'),
      userDetail: api.extend('/users/:id'),
      userPosts: api.extend('/users/:id/posts'),
      adminUser: '/api/v1/admin/:id',
      catchAll: '/:slug',
      special: '/special',
      catchAllWildcard: '/*',
    }

    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)

    // Pure specificity order (more specific first). Static-prefixed routes come before param/wildcard ones segment by
    // segment; the bare param catch-all `/:slug` and the bare wildcard `/*` sink to the end (in that order, since a
    // required param outranks a wildcard).

    expect(ordering).toEqual([
      '/',
      '/special',
      '/api/v1',
      '/api/v1/users',
      '/api/v1/users/all',
      '/api/v1/admin/:id',
      '/api/v1/users/:id',
      '/api/v1/users/:id/posts',
      '/:slug',
      '/*',
    ])
  })

  it('Routes instance has ordering property', () => {
    const routes = Routes.create({
      home: '/',
      users: '/users',
      userDetail: '/users/:id',
    })

    expect(routes._.pathsOrdering).toBeDefined()
    expect(Array.isArray(routes._.pathsOrdering)).toBe(true)
    // Depth 1: /, /users (alphabetically)
    // Depth 2: /users/:id
    expect(routes._.pathsOrdering).toEqual(['/', '/users', '/users/:id'])
  })

  it('ordering is preserved after clone', () => {
    const routes = Routes.create({
      home: '/',
      users: '/users',
      userDetail: '/users/:id',
    })

    const originalOrdering = routes._.pathsOrdering

    const overridden = routes._.clone({ origin: 'https://example.com' })

    expect(overridden._.pathsOrdering).toEqual(originalOrdering)
    expect(overridden._.pathsOrdering).toEqual(['/', '/users', '/users/:id'])
  })

  it('_makeOrdering: handles single route', () => {
    const routes = {
      home: '/',
    }

    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)
    expect(ordering).toEqual(['/'])
  })

  it('_makeOrdering: handles empty object', () => {
    const routes = {}

    const { pathsOrdering: ordering } = Routes._.makeOrdering(routes)
    expect(ordering).toEqual([])
  })

  it('_makeOrdering: duplicate definitions under different keys keep both keys in insertion order', () => {
    const routes = Routes.create({ one: '/same/:id', two: '/same/:id' })
    expect(routes._.keysOrdering).toEqual(['one', 'two'])
    expect(routes._.pathsOrdering).toEqual(['/same/:id', '/same/:id'])
  })

  it('ordered routes agree with keysOrdering and pathsOrdering', () => {
    const routes = Routes.create({
      detail: '/users/:id',
      list: '/users',
      any: '/users/*?',
    })
    expect(routes._.ordered.map((route) => route.definition)).toEqual(routes._.pathsOrdering)
    const byKey: Record<string, CallableRoute> = routes._.routes
    expect(routes._.keysOrdering.map((key) => byKey[key].definition)).toEqual(routes._.pathsOrdering)
  })

  it('isMoreSpecificThan is a strict total order (antisymmetric, transitive) over a diverse route set', () => {
    // `Array.sort` only produces a correct order from a consistent comparator. The specificity comparator once mixed
    // two orders (specificity for overlaps, depth otherwise) and was non-transitive, letting sort mis-order
    // overlapping routes. This property check over every pair/triple guards against reintroducing that.
    const defs = [
      '/',
      '/:slug',
      '/:slug?',
      '/*',
      '/*?',
      '/a',
      '/a/:id',
      '/a/:id?',
      '/a/*',
      '/a/*?',
      '/a/b',
      '/a/b/:c',
      '/a/:x/c',
      '/x*',
      '/a/b/c/d',
      '/:x/:y',
    ]
    const instances = defs.map((definition) => Route0.create(definition))
    for (const a of instances) {
      expect(a.isMoreSpecificThan(a)).toBe(false) // irreflexive
      for (const b of instances) {
        if (a.definition !== b.definition) {
          // total + antisymmetric: exactly one direction holds
          expect(a.isMoreSpecificThan(b)).not.toBe(b.isMoreSpecificThan(a))
        }
        for (const c of instances) {
          if (a.isMoreSpecificThan(b) && b.isMoreSpecificThan(c)) {
            expect(a.isMoreSpecificThan(c)).toBe(true) // transitive
          }
        }
      }
    }
  })

  it('_makeOrdering result is pairwise-consistent with isMoreSpecificThan', () => {
    const routes = {
      root: '/',
      slug: '/:slug',
      any: '/*',
      a: '/a',
      aId: '/a/:id',
      aOpt: '/a/:id?',
      aStar: '/a/*',
      aStarOpt: '/a/*?',
      ab: '/a/b',
      abC: '/a/b/:c',
      aXc: '/a/:x/c',
      inline: '/x*',
    }
    const { keysOrdering } = Routes._.makeOrdering(routes)
    const hydrated: Record<string, CallableRoute> = Routes._.hydrate(routes)
    for (let i = 0; i < keysOrdering.length; i++) {
      for (let j = i + 1; j < keysOrdering.length; j++) {
        // nothing later in the ordering may be strictly more specific than anything before it
        expect(hydrated[keysOrdering[j]].isMoreSpecificThan(hydrated[keysOrdering[i]])).toBe(false)
      }
    }
  })
})

describe('ordering: matching is correct and insertion-order independent', () => {
  // Point0 resolves which page to render by taking the first route (in specificity order) that matches the URL. If that
  // order depended on how routes happen to be declared, the same URL could resolve to a different page in different
  // files — the user might see the wrong page, or none at all. So every scenario is checked under many declaration
  // orders: the ordering must be identical, and each URL must resolve to the single most-specific matching route.

  const permute = <T>(arr: readonly T[]): T[][] => {
    if (arr.length <= 1) return [[...arr]]
    const out: T[][] = []
    arr.forEach((value, index) => {
      const rest = [...arr.slice(0, index), ...arr.slice(index + 1)]
      for (const tail of permute(rest)) out.push([value, ...tail])
    })
    return out
  }

  const insertionOrders = (defs: Record<string, string>): Array<Record<string, string>> => {
    const keys = Object.keys(defs)
    // exhaustive for small sets; a deterministic sample (forward, reverse, shuffles) for larger ones
    let keyOrders: string[][]
    if (keys.length <= 6) {
      keyOrders = permute(keys)
    } else {
      keyOrders = [keys, [...keys].reverse()]
      for (const seed of [1, 2, 3, 4, 5]) {
        const shuffled = [...keys]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (i * 7 + seed * 13) % (i + 1)
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        keyOrders.push(shuffled)
      }
    }
    return keyOrders.map((order) => {
      const obj: Record<string, string> = {}
      for (const key of order) obj[key] = defs[key]
      return obj
    })
  }

  const expectStableMatching = (defs: Record<string, string>, cases: Array<[url: string, expected: string]>): void => {
    const orderings = new Set<string>()
    for (const variant of insertionOrders(defs)) {
      const routes = Routes.create(variant)
      orderings.add(JSON.stringify(routes._.pathsOrdering))
      for (const [url, expected] of cases) {
        expect(routes._.getLocation(url).route ?? '<none>').toBe(expected)
      }
    }
    // the resolved ordering must not depend on insertion order
    expect(orderings.size).toBe(1)
  }

  it('static vs required param vs wildcard at one depth', () => {
    expectStableMatching({ detail: '/users/:id', create: '/users/new', list: '/users', any: '/users/*' }, [
      ['/users', '/users'],
      ['/users/new', '/users/new'],
      ['/users/42', '/users/:id'],
      ['/users/a/b', '/users/*'],
    ])
  })

  it('deep static-prefixed route wins over a shallow param (the impersonate case)', () => {
    expectStableMatching({ impersonate: '/users/impersonate/:id?', detail: '/users/:sn' }, [
      ['/users/impersonate', '/users/impersonate/:id?'],
      ['/users/impersonate/5', '/users/impersonate/:id?'],
      ['/users/bob', '/users/:sn'],
    ])
  })

  it('static segment beats a param at the same slot, anywhere in the path', () => {
    expectStableMatching({ tab: '/org/:orgId/:tab', settings: '/org/:orgId/settings', fixed: '/org/acme/settings' }, [
      ['/org/acme/settings', '/org/acme/settings'],
      ['/org/other/settings', '/org/:orgId/settings'],
      ['/org/other/general', '/org/:orgId/:tab'],
      ['/team/other/general', '<none>'],
    ])
  })

  it('optional param coexists with a static sibling', () => {
    expectStableMatching({ opt: '/posts/:id?', create: '/posts/new' }, [
      ['/posts', '/posts/:id?'],
      ['/posts/new', '/posts/new'],
      ['/posts/5', '/posts/:id?'],
    ])
  })

  it('root, static and a catch-all param at depth one', () => {
    expectStableMatching({ slug: '/:slug', root: '/', about: '/about' }, [
      ['/', '/'],
      ['/about', '/about'],
      ['/anything', '/:slug'],
    ])
  })

  it('wildcard yields to every concrete route it overlaps', () => {
    expectStableMatching({ home: '/app/home', id: '/app/:id', base: '/app', star: '/app*', opt: '/app/*?' }, [
      ['/app', '/app'],
      ['/app/home', '/app/home'],
      ['/app/settings', '/app/:id'],
      ['/app/a/b', '/app/*?'],
      ['/appstore', '/app*'],
    ])
  })

  it('deep static beats param at every position, with conflicting prefixes', () => {
    expectStableMatching(
      {
        all: '/api/v1/users/all',
        byId: '/api/v1/users/:id',
        byRes: '/api/v1/:res/:id',
        byVer: '/api/:v/users/all',
        posts: '/api/v1/users/:id/posts',
      },
      [
        ['/api/v1/users/all', '/api/v1/users/all'],
        ['/api/v1/users/42', '/api/v1/users/:id'],
        ['/api/v1/posts/9', '/api/v1/:res/:id'],
        ['/api/v2/users/all', '/api/:v/users/all'],
        ['/api/v1/users/42/posts', '/api/v1/users/:id/posts'],
      ],
    )
  })

  it('every static/param combination at depth three resolves to the most specific match', () => {
    expectStableMatching(
      {
        sss: '/a/b/c',
        ssp: '/a/b/:c',
        sps: '/a/:b/c',
        spp: '/a/:b/:c',
        pss: '/:a/b/c',
        psp: '/:a/b/:c',
        pps: '/:a/:b/c',
        ppp: '/:a/:b/:c',
      },
      [
        ['/a/b/c', '/a/b/c'],
        ['/x/b/c', '/:a/b/c'],
        ['/a/y/c', '/a/:b/c'],
        ['/a/b/z', '/a/b/:c'],
        ['/x/y/c', '/:a/:b/c'],
        ['/x/b/z', '/:a/b/:c'],
        ['/a/y/z', '/a/:b/:c'],
        ['/x/y/z', '/:a/:b/:c'],
      ],
    )
  })

  it('mixed depths, wildcards and optionals all resolve deterministically', () => {
    expectStableMatching(
      {
        root: '/',
        about: '/about',
        slug: '/:slug',
        catchAll: '/*',
        user: '/users/:id',
        userNew: '/users/new',
        users: '/users',
        userPosts: '/users/:id/posts',
        files: '/files/*?',
      },
      [
        ['/', '/'],
        ['/about', '/about'],
        ['/contact', '/:slug'],
        ['/users', '/users'],
        ['/users/new', '/users/new'],
        ['/users/7', '/users/:id'],
        ['/users/7/posts', '/users/:id/posts'],
        ['/files', '/files/*?'],
        ['/files/a/b/c', '/files/*?'],
        ['/deep/nested/unknown', '/*'],
      ],
    )
  })

  it('required param beats optional param for the same URL', () => {
    expectStableMatching({ required: '/u/:id', optional: '/u/:id?' }, [
      ['/u/42', '/u/:id'],
      ['/u', '/u/:id?'],
    ])
  })

  it('required wildcard beats optional wildcard for the same URL', () => {
    expectStableMatching({ required: '/a/*', optional: '/a/*?' }, [
      ['/a/x', '/a/*'],
      ['/a/x/y', '/a/*'],
    ])
  })

  it('param beats an inline-wildcard segment at the same slot (segment ranks: static > param > wildcard)', () => {
    // '/files*' is narrower than '/:page' textually, but a wildcard segment ranks below a param — matching one URL
    // segment exactly is treated as more specific than swallowing arbitrarily many. This pins the convention.
    expectStableMatching({ files: '/files*', page: '/:page' }, [
      ['/files-archive', '/:page'],
      ['/files/a/b', '/files*'],
      ['/about', '/:page'],
    ])
  })

  it('root with optional param and optional wildcard siblings', () => {
    expectStableMatching({ root: '/', slug: '/:slug?', rest: '/*?' }, [
      ['/', '/'],
      ['/x', '/:slug?'],
      ['/x/y', '/*?'],
    ])
  })

  it('optional param beats optional wildcard when both match the bare base', () => {
    expectStableMatching({ opt: '/docs/:page?', rest: '/docs/*?' }, [
      ['/docs', '/docs/:page?'],
      ['/docs/guide', '/docs/:page?'],
      ['/docs/a/b', '/docs/*?'],
    ])
  })
})

// describe('relations: isSame, isAncestor, isDescendant', () => {
//   relation helper tests are intentionally disabled because
//   `isSame` / old route-to-route `isAncestor` / `isDescendant`
//   APIs are currently commented out in implementation.
// })

describe('types widening', () => {
  it('any location extends any location', () => {
    expectTypeOf<UnknownLocation>().toExtend<AnyLocation>()
    expectTypeOf<KnownLocation<'/path'>>().toExtend<AnyLocation>()
    expectTypeOf<WeakDescendantLocation<'/path'>>().toExtend<AnyLocation>()
    expectTypeOf<WeakAncestorLocation<'/path'>>().toExtend<AnyLocation>()
    expectTypeOf<ExactLocation<'/path'>>().toExtend<AnyLocation>()

    expectTypeOf<UnknownLocation>().toExtend<AnyLocation>()
    expectTypeOf<KnownLocation<'/:id'>>().toExtend<AnyLocation>()
    expectTypeOf<WeakDescendantLocation<'/:id'>>().toExtend<AnyLocation>()
    expectTypeOf<WeakAncestorLocation<'/:id'>>().toExtend<AnyLocation>()
    expectTypeOf<ExactLocation<'/:id'>>().toExtend<AnyLocation>()
  })

  it('location by path extends same location by any path', () => {
    expectTypeOf<KnownLocation<any>>().toExtend<KnownLocation<'/path'>>()
    expectTypeOf<WeakDescendantLocation<any>>().toExtend<WeakDescendantLocation<'/path'>>()
    expectTypeOf<WeakAncestorLocation<any>>().toExtend<WeakAncestorLocation<'/path'>>()
    expectTypeOf<ExactLocation<any>>().toExtend<ExactLocation<'/path'>>()

    expectTypeOf<KnownLocation<any>>().toExtend<KnownLocation<'/:id'>>()
    expectTypeOf<WeakDescendantLocation<any>>().toExtend<WeakDescendantLocation<'/:id'>>()
    expectTypeOf<WeakAncestorLocation<any>>().toExtend<WeakAncestorLocation<'/:id'>>()
    expectTypeOf<ExactLocation<any>>().toExtend<ExactLocation<'/:id'>>()
  })

  it('any route definition extends any route', () => {
    expectTypeOf<AnyRoute<any>>().toExtend<AnyRoute<'/path'>>()
    expectTypeOf<AnyRoute<any>>().toExtend<AnyRoute<'/:id'>>()
  })
})

describe('Infer', () => {
  it('exposes route types via the value-access form documented in the README', () => {
    const route = Route0.create('/users/:id/:tab?').search<{ ref?: string }>()
    expect(route.get({ id: 1, '?': { ref: 'x' } })).toBe('/users/1?ref=x')

    expectTypeOf<typeof route.Infer.ParamsDefinition>().toEqualTypeOf<{ id: true; tab: false }>()
    expectTypeOf<typeof route.Infer.ParamsInput>().toEqualTypeOf<{
      id: string | number
      tab?: string | number | undefined
    }>()
    expectTypeOf<typeof route.Infer.ParamsInputStringOnly>().toEqualTypeOf<{
      id: string
      tab?: string | undefined
    }>()
    expectTypeOf<typeof route.Infer.ParamsOutput>().toEqualTypeOf<{ id: string; tab: string | undefined }>()
    expectTypeOf<typeof route.Infer.SearchInput>().toEqualTypeOf<{ ref?: string }>()
  })

  it('value-access form agrees with the indexed-access form', () => {
    const route = Route0.create('/users/:id/:tab?').search<{ ref?: string }>()
    expect(route.get({ id: 7, tab: 'posts' })).toBe('/users/7/posts')

    expectTypeOf<typeof route.Infer.ParamsDefinition>().toEqualTypeOf<(typeof route)['Infer']['ParamsDefinition']>()
    expectTypeOf<typeof route.Infer.ParamsInput>().toEqualTypeOf<(typeof route)['Infer']['ParamsInput']>()
    expectTypeOf<typeof route.Infer.ParamsInputStringOnly>().toEqualTypeOf<
      (typeof route)['Infer']['ParamsInputStringOnly']
    >()
    expectTypeOf<typeof route.Infer.ParamsOutput>().toEqualTypeOf<(typeof route)['Infer']['ParamsOutput']>()
    expectTypeOf<typeof route.Infer.SearchInput>().toEqualTypeOf<(typeof route)['Infer']['SearchInput']>()
  })

  it('agrees with the standalone type helpers', () => {
    const route = Route0.create('/users/:id/:tab?')
    expect(route.get({ id: 2 })).toBe('/users/2')

    expectTypeOf<typeof route.Infer.ParamsInput>().toEqualTypeOf<ParamsInput<typeof route>>()
    expectTypeOf<typeof route.Infer.ParamsInputStringOnly>().toEqualTypeOf<ParamsInputStringOnly<typeof route>>()
    expectTypeOf<typeof route.Infer.ParamsOutput>().toEqualTypeOf<ParamsOutput<typeof route>>()
  })

  it('infers empty params for a route with no params', () => {
    const route = Route0.create('/about')
    expect(route.get()).toBe('/about')

    expectTypeOf<typeof route.Infer.ParamsDefinition>().toEqualTypeOf<Record<never, never>>()
    expectTypeOf<typeof route.Infer.ParamsInput>().toEqualTypeOf<Record<never, never>>()
    expectTypeOf<typeof route.Infer.ParamsOutput>().toEqualTypeOf<Record<never, never>>()
  })

  it('infers all-required params as required on input and output', () => {
    const route = Route0.create('/org/:org/users/:id')
    expect(route.get({ org: 'acme', id: '9' })).toBe('/org/acme/users/9')

    expectTypeOf<typeof route.Infer.ParamsDefinition>().toEqualTypeOf<{ org: true; id: true }>()
    expectTypeOf<typeof route.Infer.ParamsInput>().toEqualTypeOf<{
      org: string | number
      id: string | number
    }>()
    expectTypeOf<typeof route.Infer.ParamsOutput>().toEqualTypeOf<{ org: string; id: string }>()
  })

  it('infers wildcard and optional-wildcard params', () => {
    const required = Route0.create('/files*')
    const optional = Route0.create('/files/*?')
    expect(required.get({ '*': '/a/b' })).toBe('/files/a/b')
    expect(optional.get()).toBe('/files')

    expectTypeOf<typeof required.Infer.ParamsDefinition>().toEqualTypeOf<{ '*': true }>()
    expectTypeOf<typeof required.Infer.ParamsOutput>().toEqualTypeOf<{ '*': string }>()
    expectTypeOf<typeof optional.Infer.ParamsDefinition>().toEqualTypeOf<{ '*': false }>()
    expectTypeOf<typeof optional.Infer.ParamsOutput>().toEqualTypeOf<{ '*': string | undefined }>()
  })

  it('defaults SearchInput to UnknownSearchInput until narrowed with .search<…>()', () => {
    const route = Route0.create('/search')
    expect(route.get({ '?': { q: 'x' } })).toBe('/search?q=x')
    expectTypeOf<typeof route.Infer.SearchInput>().toEqualTypeOf<UnknownSearchInput>()

    const narrowed = route.search<{ q: string; page?: number }>()
    expect(narrowed.get({ '?': { q: 'a', page: 2 } })).toBe('/search?q=a&page=2')
    expectTypeOf<typeof narrowed.Infer.SearchInput>().toEqualTypeOf<{ q: string; page?: number }>()
  })
})
