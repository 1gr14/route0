import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { parse as parseSearchQuery, stringify as stringifySearchQuery } from '@1gr14/flat'

export type RouteToken =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string; optional: boolean }
  | { kind: 'wildcard'; prefix: string; optional: boolean }

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const collapseDuplicateSlashes = (value: string): string => value.replace(/\/{2,}/g, '/')

/**
 * Strongly typed route descriptor and URL builder.
 *
 * A route definition uses:
 *
 * - path params: `/users/:id`
 * - named search keys: `/users&tab&sort`
 * - loose search mode: trailing `&`, e.g. `/users&`
 *
 * Instances are callable (same as `.get()`), so `route(input)` and `route.get(input)` are equivalent.
 */
export class Route0<TDefinition extends string, TSearchInput extends UnknownSearchInput = UnknownSearchInput> {
  readonly definition: TDefinition
  readonly params: _ParamsDefinition<TDefinition>
  private _origin: string | undefined
  private _callable: CallableRoute<TDefinition, TSearchInput>
  private _routeSegments?: string[]
  private _routeTokens?: RouteToken[]
  private _routePatternCandidates?: string[]
  private _pathParamsDefinition?: Record<string, boolean>
  private _definitionWithoutTrailingWildcard?: string
  private _routeRegexBaseStringRaw?: string
  private _regexBaseString?: string
  private _regexString?: string
  private _regex?: RegExp
  private _regexAncestor?: RegExp
  private _regexDescendantMatchers?: Array<{ regex: RegExp; captureKeys: string[] }>
  private _captureKeys?: string[]
  private _normalizedDefinition?: string
  private _definitionParts?: string[]

  static normalizeSlash = (value: string): string => {
    const collapsed = collapseDuplicateSlashes(value)
    if (collapsed === '' || collapsed === '/') return '/'
    const withLeadingSlash = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
    return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash
  }

  private static _getRouteSegments(definition: string): string[] {
    if (definition === '' || definition === '/') return []
    return definition.split('/').filter(Boolean)
  }

  /** Splits a definition into specificity-ranking parts (`/` stays a single part). */
  private static _specificityParts(definition: string): string[] {
    if (definition === '/') return ['/']
    return definition.split('/').filter(Boolean)
  }

  /** Ranks a single path part by specificity: static > required param > optional param > wildcard. */
  private static _partRank(part: string): number {
    if (part.includes('*')) return -1
    if (part.startsWith(':') && part.endsWith('?')) return 0
    if (part.startsWith(':')) return 1
    return 2
  }

  /**
   * Total, transitive specificity order. Negative ⇒ `a` is more specific (sorts first).
   *
   * Compares segment ranks left-to-right (static > required param > optional param > wildcard). A shorter route that is
   * a prefix of a longer one is treated as more specific (its missing segments rank above any real segment), so exact
   * static routes win over deeper optional/param tails. Fully equal structures fall back to the definition string so
   * the order is deterministic regardless of insertion order — critical because the matcher relies on it to pick the
   * right page.
   */
  private static _compareSpecificity(aDefinition: string, bDefinition: string): number {
    const aParts = Route0._specificityParts(aDefinition)
    const bParts = Route0._specificityParts(bDefinition)
    const length = Math.max(aParts.length, bParts.length)
    for (let i = 0; i < length; i++) {
      // a missing segment ranks above any real one => the shorter (more exact) route sorts first
      const aRank = i < aParts.length ? Route0._partRank(aParts[i]) : Number.POSITIVE_INFINITY
      const bRank = i < bParts.length ? Route0._partRank(bParts[i]) : Number.POSITIVE_INFINITY
      if (aRank !== bRank) return bRank - aRank
    }
    return aDefinition < bDefinition ? -1 : aDefinition > bDefinition ? 1 : 0
  }

  private static _validateRouteDefinition(definition: string): void {
    const segments = Route0._getRouteSegments(definition)
    const wildcardSegments = segments.filter((segment) => segment.includes('*'))
    if (wildcardSegments.length === 0) return
    if (wildcardSegments.length > 1) {
      throw new Error(`Invalid route definition "${definition}": only one wildcard segment is allowed`)
    }
    const wildcardSegmentIndex = segments.findIndex((segment) => segment.includes('*'))
    const wildcardSegment = segments[wildcardSegmentIndex]
    if (!wildcardSegment.match(/^(?:\*|\*\?|[^*]+\*|\S+\*\?)$/)) {
      throw new Error(`Invalid route definition "${definition}": wildcard must be trailing in its segment`)
    }
    if (wildcardSegmentIndex !== segments.length - 1) {
      throw new Error(`Invalid route definition "${definition}": wildcard segment is allowed only at the end`)
    }
  }

  Infer: {
    ParamsDefinition: _ParamsDefinition<TDefinition>
    ParamsInput: _ParamsInput<TDefinition>
    ParamsInputStringOnly: _ParamsInputStringOnly<TDefinition>
    ParamsOutput: ParamsOutput<TDefinition>
    SearchInput: TSearchInput
  } = null as never

  /** Base URL used when generating absolute URLs (`abs: true`). */
  get origin(): string {
    if (!this._origin) {
      throw new Error(
        'origin for route ' +
          this.definition +
          ' is not set, please provide it like Route0.create(route, {origin: "https://example.com"}) in config or set via clones like routes._.clone({origin: "https://example.com"})',
      )
    }
    return this._origin
  }
  set origin(origin: string) {
    this._origin = origin
  }

  private constructor(definition: TDefinition, config: RouteConfigInput = {}) {
    const normalizedDefinition = Route0.normalizeSlash(definition) as TDefinition
    Route0._validateRouteDefinition(normalizedDefinition)
    this.definition = normalizedDefinition
    this.params = this.pathParamsDefinition as _ParamsDefinition<TDefinition>

    const { origin } = config
    if (origin && typeof origin === 'string' && origin.length) {
      this._origin = origin
    } else {
      const g = globalThis as unknown as { location?: { origin?: string } } | undefined
      if (typeof g?.location?.origin === 'string' && g.location.origin.length > 0) {
        this._origin = g.location.origin
      } else {
        this._origin = undefined
      }
    }
    const callable = this.get.bind(this)
    Object.setPrototypeOf(callable, this)
    Object.defineProperty(callable, Symbol.toStringTag, {
      value: this.definition,
    })
    this._callable = callable as CallableRoute<TDefinition, TSearchInput>
  }

  /**
   * Creates a callable route instance.
   *
   * If an existing route/callable route is provided, it is cloned.
   */
  static create<TDefinition extends string>(
    definition: TDefinition | AnyRoute<TDefinition> | CallableRoute<TDefinition>,
    config?: RouteConfigInput,
  ): CallableRoute<NormalizeRouteDefinition<TDefinition>> {
    if (typeof definition === 'function' || typeof definition === 'object') {
      return definition.clone(config) as CallableRoute<NormalizeRouteDefinition<TDefinition>>
    }
    const original = new Route0<NormalizeRouteDefinition<TDefinition>>(
      Route0.normalizeSlash(definition) as NormalizeRouteDefinition<TDefinition>,
      config,
    )
    return original._callable as CallableRoute<NormalizeRouteDefinition<TDefinition>>
  }

  /**
   * Normalizes a definition/route into a callable route.
   *
   * Unlike `create`, passing a callable route returns the same instance.
   */
  static from<TDefinition extends string, TSearchInput extends UnknownSearchInput>(
    definition: TDefinition | AnyRoute<TDefinition, TSearchInput> | CallableRoute<TDefinition, TSearchInput>,
  ): CallableRoute<NormalizeRouteDefinition<TDefinition>, TSearchInput> {
    if (typeof definition === 'function') {
      return definition as CallableRoute<NormalizeRouteDefinition<TDefinition>, TSearchInput>
    }
    const original =
      typeof definition === 'object'
        ? definition
        : new Route0<NormalizeRouteDefinition<TDefinition>>(
            Route0.normalizeSlash(definition) as NormalizeRouteDefinition<TDefinition>,
          )
    return original._callable as CallableRoute<NormalizeRouteDefinition<TDefinition>, TSearchInput>
  }

  private static _getAbsPath(origin: string, url: string, encode = true) {
    // unencoded: keep the path raw (URL's serializer would percent-encode it), just prefix the origin's scheme+host
    if (!encode) return `${new URL(origin).origin}${url}`.replace(/\/$/, '')
    return new URL(url, origin).toString().replace(/\/$/, '')
  }

  search<TNewSearchInput extends UnknownSearchInput>(): CallableRoute<TDefinition, TNewSearchInput> {
    return this._callable as CallableRoute<TDefinition, TNewSearchInput>
  }

  /** Extends the current route definition by appending a suffix route. */
  extend<TSuffixDefinition extends string>(
    suffixDefinition: TSuffixDefinition,
  ): CallableRoute<PathExtended<TDefinition, TSuffixDefinition>, TSearchInput> {
    const definition = Route0.normalizeSlash(`${this.definitionWithoutTrailingWildcard}/${suffixDefinition}`)
    return Route0.create<PathExtended<TDefinition, TSuffixDefinition>>(
      definition as PathExtended<TDefinition, TSuffixDefinition>,
      {
        origin: this._origin,
      },
    ) as CallableRoute<PathExtended<TDefinition, TSuffixDefinition>, TSearchInput>
  }

  get(
    ...args: IsParamsOptional<TDefinition> extends true
      ? [input?: GetPathInput<TDefinition, TSearchInput> | undefined, options?: RouteGetOptions]
      : [input: GetPathInput<TDefinition, TSearchInput>, options?: RouteGetOptions]
  ): string

  // implementation
  get(...args: unknown[]): string {
    return this._build(args, false)
  }

  /**
   * Builds an absolute URL. Same as `get`, but `origin` defaults to `true` (use the route's configured origin).
   *
   * Override with `{ origin: 'https://other.com' }`, or force relative with `{ origin: false }`.
   */
  abs(
    ...args: IsParamsOptional<TDefinition> extends true
      ? [input?: GetPathInput<TDefinition, TSearchInput> | undefined, options?: RouteGetOptions]
      : [input: GetPathInput<TDefinition, TSearchInput>, options?: RouteGetOptions]
  ): string
  abs(...args: unknown[]): string {
    return this._build(args, true)
  }

  private _build(args: unknown[], originByDefault: boolean): string {
    const input = typeof args[0] === 'object' && args[0] !== null ? (args[0] as Record<string, unknown>) : {}
    const options = typeof args[1] === 'object' && args[1] !== null ? (args[1] as RouteGetOptions) : {}

    const origin = options.origin ?? (originByDefault ? true : undefined)
    const encode = options.encode !== false
    const absOriginInput = typeof origin === 'string' && origin.length > 0 ? origin : undefined
    const absInput = absOriginInput !== undefined || origin === true
    const enc = encode ? encodeURIComponent : (value: string): string => value

    let searchInput: Record<string, unknown> = {}
    let hashInput: string | undefined = undefined
    const paramsInput: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(input)) {
      if (key === '?' && typeof value === 'object' && value !== null) {
        searchInput = value as Record<string, unknown>
      } else if (key === '#' && (typeof value === 'string' || typeof value === 'number')) {
        hashInput = String(value)
      } else if (key in this.params && (typeof value === 'string' || typeof value === 'number')) {
        Object.assign(paramsInput, { [key]: String(value) })
      }
    }

    // create url

    let url = this.definition as string
    // optional named params like /:id?
    url = url.replace(/\/:([A-Za-z0-9_]+)\?/g, (_m, k) => {
      const value = paramsInput[k]
      if (value === undefined) return ''
      return `/${enc(String(value))}`
    })
    // required named params
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    url = url.replace(/:([A-Za-z0-9_]+)(?!\?)/g, (_m, k) => enc(String(paramsInput?.[k] ?? 'undefined')))
    // optional wildcard segment (/*?)
    url = url.replace(/\/\*\?/g, () => {
      const value = paramsInput['*']
      if (value === undefined) return ''
      const stringValue = String(value)
      return stringValue.startsWith('/') ? stringValue : `/${stringValue}`
    })
    // required wildcard segment (/*)
    url = url.replace(/\/\*/g, () => {
      const value = String(paramsInput['*'] ?? '')
      return value.startsWith('/') ? value : `/${value}`
    })
    // optional wildcard inline (e.g. /app*?)
    url = url.replace(/\*\?/g, () => String(paramsInput['*'] ?? ''))
    // required wildcard inline (e.g. /app*)
    url = url.replace(/\*/g, () => String(paramsInput['*'] ?? ''))
    // search params
    const searchString = stringifySearchQuery(searchInput, { arrayIndexes: false, encode })
    url = [url, searchString].filter(Boolean).join('?')
    // dedupe slashes
    url = collapseDuplicateSlashes(url)
    // relative root: an all-optional route with nothing supplied collapses to "/"
    if (url === '') url = '/'
    // absolute (origin already strips the trailing slash)
    url = absInput ? Route0._getAbsPath(absOriginInput || this.origin, url, encode) : url
    // hash
    if (hashInput !== undefined) {
      url = `${url}#${hashInput}`
    }

    return url
  }

  /** Returns path param keys extracted from route definition. */
  getParamsKeys(): string[] {
    return Object.keys(this.params)
  }

  getTokens(): RouteToken[] {
    return this.routeTokens.map((token): RouteToken => ({ ...token }))
  }

  /** Clones route with optional config override. */
  clone(config?: RouteConfigInput): CallableRoute<TDefinition> {
    return Route0.create(this.definition, config) as CallableRoute<TDefinition>
  }

  get regexBaseString(): string {
    if (this._regexBaseString === undefined) {
      if (this.definition === '/') {
        this._regexBaseString = '/'
      } else {
        this._regexBaseString = this.routeRegexBaseStringRaw.replace(/\/+$/, '') + '/?' // remove trailing slashes and add optional slash
      }
    }
    return this._regexBaseString
  }

  get regexString(): string {
    if (this._regexString === undefined) {
      this._regexString = `^${this.regexBaseString}$`
    }
    return this._regexString
  }

  get regex(): RegExp {
    if (this._regex === undefined) {
      this._regex = new RegExp(this.regexString)
    }
    return this._regex
  }

  get regexAncestor(): RegExp {
    if (this._regexAncestor === undefined) {
      if (this.definition === '/') {
        this._regexAncestor = /^\/.+$/
      } else {
        this._regexAncestor = new RegExp(`^${this.regexBaseString}(?:/.*)?$`)
      }
    }
    return this._regexAncestor
  }

  private get regexDescendantMatchers(): Array<{ regex: RegExp; captureKeys: string[] }> {
    if (this._regexDescendantMatchers === undefined) {
      const matchers: Array<{ regex: RegExp; captureKeys: string[] }> = []
      if (this.definitionParts[0] !== '/') {
        let pattern = ''
        const captureKeys: string[] = []
        for (const part of this.definitionParts) {
          if (part.startsWith(':')) {
            pattern += '/([^/]+)'
            captureKeys.push(part.replace(/^:/, '').replace(/\?$/, ''))
          } else if (part.includes('*')) {
            const prefix = part.replace(/\*\??$/, '')
            pattern += `/${escapeRegex(prefix)}[^/]*`
            captureKeys.push('*')
          } else {
            pattern += `/${escapeRegex(part)}`
          }
          matchers.push({
            regex: new RegExp(`^${pattern}/?$`),
            captureKeys: [...captureKeys],
          })
        }
      }
      this._regexDescendantMatchers = matchers
    }
    return this._regexDescendantMatchers
  }

  private get captureKeys(): string[] {
    if (this._captureKeys === undefined) {
      this._captureKeys = this.routeTokens
        .filter((token): token is Extract<RouteToken, { kind: 'param' | 'wildcard' }> => token.kind !== 'static')
        .map((token) => (token.kind === 'param' ? token.name : '*'))
    }
    return this._captureKeys
  }

  private get routeSegments(): string[] {
    if (this._routeSegments === undefined) {
      this._routeSegments = Route0._getRouteSegments(this.definition)
    }
    return this._routeSegments
  }

  private get routeTokens(): RouteToken[] {
    if (this._routeTokens === undefined) {
      this._routeTokens = this.routeSegments.map((segment): RouteToken => {
        const param = segment.match(/^:([A-Za-z0-9_]+)(\?)?$/)
        if (param) {
          return { kind: 'param', name: param[1], optional: param[2] === '?' }
        }
        if (segment === '*' || segment === '*?') {
          return { kind: 'wildcard', prefix: '', optional: segment.endsWith('?') }
        }
        const wildcard = segment.match(/^(.*)\*(\?)?$/)
        if (wildcard && !segment.includes('\\*')) {
          return { kind: 'wildcard', prefix: wildcard[1], optional: wildcard[2] === '?' }
        }
        return { kind: 'static', value: segment }
      })
    }
    return this._routeTokens
  }

  private get routePatternCandidates(): string[] {
    if (this._routePatternCandidates === undefined) {
      const values = (token: RouteToken): string[] => {
        if (token.kind === 'static') return [token.value]
        if (token.kind === 'param') return token.optional ? ['', 'x', 'y'] : ['x', 'y']
        if (token.prefix.length > 0)
          return [token.prefix, `${token.prefix}-x`, `${token.prefix}/x`, `${token.prefix}/y/z`]
        return ['', 'x', 'y', 'x/y']
      }
      let acc: string[] = ['']
      for (const token of this.routeTokens) {
        const next: string[] = []
        for (const base of acc) {
          for (const value of values(token)) {
            if (value === '') {
              next.push(base)
            } else if (value.startsWith('/')) {
              next.push(`${base}${value}`)
            } else {
              next.push(`${base}/${value}`)
            }
          }
        }
        // Keep candidate space bounded for large route definitions.
        acc = next.length > 512 ? next.slice(0, 512) : next
      }
      this._routePatternCandidates =
        acc.length === 0 ? ['/'] : Array.from(new Set(acc.map((x) => (x === '' ? '/' : collapseDuplicateSlashes(x)))))
    }
    return this._routePatternCandidates
  }

  private get pathParamsDefinition(): Record<string, boolean> {
    if (this._pathParamsDefinition === undefined) {
      const entries = this.routeTokens
        .filter((t) => t.kind !== 'static')
        .map((t): [string, boolean] => (t.kind === 'param' ? [t.name, !t.optional] : ['*', !t.optional]))
      this._pathParamsDefinition = Object.fromEntries(entries)
    }
    return this._pathParamsDefinition
  }

  private get definitionWithoutTrailingWildcard(): string {
    if (this._definitionWithoutTrailingWildcard === undefined) {
      this._definitionWithoutTrailingWildcard = this.definition.replace(/\*\??$/, '')
    }
    return this._definitionWithoutTrailingWildcard
  }

  private get routeRegexBaseStringRaw(): string {
    if (this._routeRegexBaseStringRaw === undefined) {
      if (this.routeTokens.length === 0) {
        this._routeRegexBaseStringRaw = ''
      } else {
        let pattern = ''
        for (const token of this.routeTokens) {
          if (token.kind === 'static') {
            pattern += `/${escapeRegex(token.value)}`
            continue
          }
          if (token.kind === 'param') {
            pattern += token.optional ? '(?:/([^/]+))?' : '/([^/]+)'
            continue
          }
          if (token.prefix.length > 0) {
            pattern += `/${escapeRegex(token.prefix)}(.*)`
          } else {
            // Wouter-compatible splat: /orders/* matches /orders and /orders/...
            pattern += '(?:/(.*))?'
          }
        }
        this._routeRegexBaseStringRaw = pattern
      }
    }
    return this._routeRegexBaseStringRaw
  }

  private get normalizedDefinition(): string {
    if (this._normalizedDefinition === undefined) {
      this._normalizedDefinition =
        this.definition.length > 1 && this.definition.endsWith('/') ? this.definition.slice(0, -1) : this.definition
    }
    return this._normalizedDefinition
  }

  private get definitionParts(): string[] {
    if (this._definitionParts === undefined) {
      this._definitionParts =
        this.normalizedDefinition === '/' ? ['/'] : this.normalizedDefinition.split('/').filter(Boolean)
    }
    return this._definitionParts
  }

  /** Fast pathname exact match check without building a full relation object. */
  isExact(pathname: string, normalize = true): boolean {
    const normalizedPathname = normalize ? Route0.normalizeSlash(pathname) : pathname
    return this.regex.test(normalizedPathname)
  }

  /** Fast pathname exact or ancestor match check without building a full relation object. */
  isExactOrAncestor(pathname: string, normalize = true): boolean {
    const normalizedPathname = normalize ? Route0.normalizeSlash(pathname) : pathname
    return this.regex.test(normalizedPathname) || this.regexAncestor.test(normalizedPathname)
  }

  /** True when route is ancestor of pathname (pathname is deeper). */
  isAncestor(pathname: string, normalize = true): boolean {
    const normalizedPathname = normalize ? Route0.normalizeSlash(pathname) : pathname
    return !this.regex.test(normalizedPathname) && this.regexAncestor.test(normalizedPathname)
  }

  /** True when route is descendant of pathname (pathname is shallower). */
  isDescendant(pathname: string, normalize = true): boolean {
    const normalizedPathname = normalize ? Route0.normalizeSlash(pathname) : pathname
    if (this.regex.test(normalizedPathname) || this.regexAncestor.test(normalizedPathname)) {
      return false
    }
    for (const matcher of this.regexDescendantMatchers) {
      if (normalizedPathname.match(matcher.regex)) {
        return true
      }
    }
    return false
  }

  /** Creates a grouped regex pattern string from many routes. */
  static getRegexStringGroup(routes: AnyRoute[]): string {
    const patterns = routes.map((route) => `(?:${route.regexBaseString})`).join('|')
    return `^(?:${patterns})$`
  }

  /** Creates a grouped regex from many routes. */
  static getRegexGroup(routes: AnyRoute[]): RegExp {
    return new RegExp(Route0.getRegexStringGroup(routes))
  }

  /** Converts any location shape to relative form (removes host/origin fields). */
  static toRelLocation<TLocation extends AnyLocation>(location: TLocation): TLocation {
    return {
      ...location,
      abs: false,
      origin: undefined,
      href: undefined,
      port: undefined,
      host: undefined,
      hostname: undefined,
    }
  }

  /** Converts a location to absolute form using provided origin URL. */
  static toAbsLocation<TLocation extends AnyLocation>(location: TLocation, origin: string): TLocation {
    const relLoc = Route0.toRelLocation(location)
    const url = new URL(relLoc.hrefRel, origin)
    return {
      ...location,
      abs: true,
      origin: url.origin,
      href: url.href,
      port: url.port,
      host: url.host,
      hostname: url.hostname,
    }
  }

  /**
   * Parses a URL-like input into raw location object (without route knowledge).
   *
   * Result is always `UnknownLocation` because no route matching is applied.
   */
  static getLocation(href: `${string}://${string}`): UnknownLocation
  static getLocation(hrefRel: `/${string}`): UnknownLocation
  static getLocation(hrefOrHrefRel: string): UnknownLocation
  static getLocation(location: AnyLocation): UnknownLocation
  static getLocation(url: URL): UnknownLocation
  static getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): UnknownLocation
  static getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): UnknownLocation {
    if (hrefOrHrefRelOrLocation instanceof URL) {
      return Route0.getLocation(hrefOrHrefRelOrLocation.href)
    }
    if (typeof hrefOrHrefRelOrLocation !== 'string') {
      hrefOrHrefRelOrLocation = hrefOrHrefRelOrLocation.href || hrefOrHrefRelOrLocation.hrefRel
    }
    // Check if it's an absolute URL (starts with scheme://)
    const abs = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(hrefOrHrefRelOrLocation)

    // Use dummy base only if relative
    const base = abs ? undefined : 'http://example.com'
    const url = new URL(hrefOrHrefRelOrLocation, base)

    // Common derived values
    const hrefRel = url.pathname + url.search + url.hash

    // Build the location object consistent with _GeneralLocation
    let _search: UnknownSearchParsed | undefined
    const location: UnknownLocation = {
      pathname: url.pathname,
      get search() {
        if (_search === undefined) {
          _search = parseSearchQuery(url.search)
        }
        return _search
      },
      searchString: url.search,
      hash: url.hash,
      origin: abs ? url.origin : undefined,
      href: abs ? url.href : undefined,
      hrefRel,
      abs,

      // extra host-related fields (available even for relative with dummy base)
      host: abs ? url.host : undefined,
      hostname: abs ? url.hostname : undefined,
      port: abs ? url.port || undefined : undefined,

      // specific to UnknownLocation
      params: undefined,
      route: undefined,
    }

    return location
  }

  // /**
  //  * Parses input and returns location only for exact route matches.
  //  */
  // getLocation(href: `${string}://${string}`): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(hrefRel: `/${string}`): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(hrefOrHrefRel: string): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(location: AnyLocation): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(url: AnyLocation): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): ExactLocation<TDefinition> | UnknownLocation
  // getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): ExactLocation<TDefinition> | UnknownLocation {
  //   const relation = this.getRelation(hrefOrHrefRelOrLocation)
  //   if (!relation.exact) {
  //     return Route0.getLocation(hrefOrHrefRelOrLocation)
  //   }
  //   const location = Route0.getLocation(hrefOrHrefRelOrLocation)
  //   return {
  //     ...location,
  //     route: this.definition as Definition<TDefinition>,
  //     params: relation.params as ParamsOutput<TDefinition>,
  //   }
  // }

  /**
   * Parses input and evaluates pathname relation to this route.
   */
  getRelation(href: `${string}://${string}`): RouteRelation<TDefinition>
  getRelation(hrefRel: `/${string}`): RouteRelation<TDefinition>
  getRelation(hrefOrHrefRel: string): RouteRelation<TDefinition>
  getRelation(location: AnyLocation): RouteRelation<TDefinition>
  getRelation(url: URL): RouteRelation<TDefinition>
  getRelation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): RouteRelation<TDefinition>
  getRelation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): RouteRelation<TDefinition> {
    if (hrefOrHrefRelOrLocation instanceof URL) {
      return this.getRelation(hrefOrHrefRelOrLocation.href)
    }
    if (typeof hrefOrHrefRelOrLocation !== 'string') {
      hrefOrHrefRelOrLocation = hrefOrHrefRelOrLocation.href || hrefOrHrefRelOrLocation.hrefRel
    }
    // Normalize pathname (no trailing slash except root)
    const pathname = Route0.normalizeSlash(new URL(hrefOrHrefRelOrLocation, 'http://example.com').pathname)

    const paramNames = this.captureKeys
    const exactRe = this.regex
    const exactMatch = pathname.match(exactRe)

    if (exactMatch) {
      const values = exactMatch.slice(1, 1 + paramNames.length)
      const params = Object.fromEntries(
        paramNames.map((n, i) => {
          const value = values[i] as string | undefined
          return [n, value === undefined ? undefined : decodeURIComponent(value)]
        }),
      )
      return {
        type: 'exact',
        route: this.definition as Definition<TDefinition>,
        params: params as ParamsOutput<TDefinition>,
        exact: true,
        ancestor: false,
        descendant: false,
        unmatched: false,
      }
    }

    const ancestorRe = this.regexAncestor
    const ancestorMatch = pathname.match(ancestorRe)
    if (ancestorMatch) {
      const values = ancestorMatch.slice(1, 1 + paramNames.length)
      const params = Object.fromEntries(
        paramNames.map((n, i) => {
          const value = values[i] as string | undefined
          return [n, value === undefined ? undefined : decodeURIComponent(value)]
        }),
      )
      return {
        type: 'ancestor',
        route: this.definition as Definition<TDefinition>,
        params: params as ParamsOutput<TDefinition>,
        exact: false,
        ancestor: true,
        descendant: false,
        unmatched: false,
      }
    }

    let descendantMatch: RegExpMatchArray | null = null
    let descendantCaptureKeys: string[] = []
    for (const matcher of this.regexDescendantMatchers) {
      const match = pathname.match(matcher.regex)
      if (!match) continue
      descendantMatch = match
      descendantCaptureKeys = matcher.captureKeys
      break
    }

    if (descendantMatch) {
      const values = descendantMatch.slice(1, 1 + descendantCaptureKeys.length)
      const params = Object.fromEntries(
        descendantCaptureKeys.map((key, index) => [key, decodeURIComponent(values[index] as string)]),
      )
      return {
        type: 'descendant',
        route: this.definition as Definition<TDefinition>,
        params: params as Partial<ParamsOutput<TDefinition>>,
        exact: false,
        ancestor: false,
        descendant: true,
        unmatched: false,
      }
    }

    return {
      type: 'unmatched',
      route: this.definition as Definition<TDefinition>,
      params: {},
      exact: false,
      ancestor: false,
      descendant: false,
      unmatched: true,
    }
  }

  private _validateParamsInput(input: unknown): StandardSchemaV1.Result<ParamsOutput<TDefinition>> {
    const paramsEntries = Object.entries(this.params) as Array<[string, boolean]>
    const paramsMap = this.params as Record<string, boolean>
    const requiredParamsKeys = paramsEntries.filter(([, required]) => required).map(([k]) => k)
    const paramsKeys = paramsEntries.map(([k]) => k)
    if (input === undefined) {
      if (requiredParamsKeys.length) {
        return {
          issues: [
            {
              message: `Missing params: ${requiredParamsKeys.map((k) => `"${k}"`).join(', ')}`,
            },
          ],
        }
      }
      input = {}
    }
    if (typeof input !== 'object' || input === null) {
      return {
        issues: [{ message: 'Invalid route params: expected object' }],
      }
    }
    const inputObj = input as Record<string, unknown>
    const inputKeys = Object.keys(inputObj)
    const notDefinedKeys = requiredParamsKeys.filter((k) => !inputKeys.includes(k))
    if (notDefinedKeys.length) {
      return {
        issues: [
          {
            message: `Missing params: ${notDefinedKeys.map((k) => `"${k}"`).join(', ')}`,
          },
        ],
      }
    }
    const data: Record<string, string | undefined> = {}
    for (const k of paramsKeys) {
      const v = inputObj[k]
      const required = paramsMap[k]
      if (v === undefined && !required) {
        data[k] = undefined as never
      } else if (typeof v === 'string') {
        data[k] = v
      } else if (typeof v === 'number') {
        data[k] = String(v)
      } else {
        return {
          issues: [{ message: `Invalid route params: expected string, number, got ${typeof v} for "${k}"` }],
        }
      }
    }
    return {
      value: data as ParamsOutput<TDefinition>,
    }
  }

  private _safeParseSchemaResult<TOutput extends Record<string, unknown>>(
    result: StandardSchemaV1.Result<TOutput>,
  ): _SafeParseInputResult<TOutput> {
    if ('issues' in result) {
      return {
        success: false,
        data: undefined,
        error: new Error(result.issues?.[0]?.message ?? 'Invalid input'),
      }
    }
    return {
      success: true,
      data: result.value,
      error: undefined,
    }
  }

  private _parseSchemaResult<TOutput extends Record<string, unknown>>(
    result: StandardSchemaV1.Result<TOutput>,
  ): TOutput {
    const safeResult = this._safeParseSchemaResult(result)
    if (safeResult.error) {
      throw safeResult.error
    }
    return safeResult.data
  }

  private _getParamsInputJSONSchema(options: StandardJSONSchemaV1.Options): Record<string, unknown> {
    const { target } = options
    const properties = Object.fromEntries(
      Object.keys(this.params).map((key): [string, Record<string, unknown>] => [
        key,
        {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      ]),
    )
    const required = Object.entries(this.params)
      .filter(([, isRequired]) => isRequired)
      .map(([key]) => key)
    const targetMeta =
      target === 'draft-2020-12'
        ? { $schema: 'https://json-schema.org/draft/2020-12/schema' }
        : target === 'draft-07'
          ? { $schema: 'http://json-schema.org/draft-07/schema#' }
          : {}
    return {
      ...targetMeta,
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    }
  }

  private _getParamsOutputJSONSchema(options: StandardJSONSchemaV1.Options): Record<string, unknown> {
    const { target } = options
    const properties = Object.fromEntries(
      Object.keys(this.params).map((key): [string, Record<string, unknown>] => [
        key,
        {
          type: 'string',
        },
      ]),
    )
    const required = Object.entries(this.params)
      .filter(([, isRequired]) => isRequired)
      .map(([key]) => key)
    const targetMeta =
      target === 'draft-2020-12'
        ? { $schema: 'https://json-schema.org/draft/2020-12/schema' }
        : target === 'draft-07'
          ? { $schema: 'http://json-schema.org/draft-07/schema#' }
          : {}
    return {
      ...targetMeta,
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    }
  }

  /** Standard Schema for route params input. */
  readonly schema: SchemaRoute0<ParamsInput<TDefinition>, ParamsOutput<TDefinition>> = {
    '~standard': {
      version: 1,
      vendor: 'route0',
      validate: (value) => this._validateParamsInput(value),
      jsonSchema: {
        input: (options) => this._getParamsInputJSONSchema(options),
        output: (options) => this._getParamsOutputJSONSchema(options),
      },
      types: undefined as unknown as StandardSchemaV1.Types<ParamsInput<TDefinition>, ParamsOutput<TDefinition>>,
    },
    parse: (value) => this._parseSchemaResult(this._validateParamsInput(value)),
    safeParse: (value) => this._safeParseSchemaResult(this._validateParamsInput(value)),
  }

  // /** True when path structure is equal (param names are ignored). */
  // isSame(other: AnyRoute): boolean {
  //   const thisShape = this.routeTokens
  //     .map((t) => {
  //       if (t.kind === 'static') return `s:${t.value}`
  //       if (t.kind === 'param') return `p:${t.optional ? 'o' : 'r'}`
  //       return `w:${t.prefix}:${t.optional ? 'o' : 'r'}`
  //     })
  //     .join('/')
  //   const otherRoute = Route0.from(other) as Route0<string, UnknownSearchInput>
  //   const otherShape = otherRoute.routeTokens
  //     .map((t) => {
  //       if (t.kind === 'static') return `s:${t.value}`
  //       if (t.kind === 'param') return `p:${t.optional ? 'o' : 'r'}`
  //       return `w:${t.prefix}:${t.optional ? 'o' : 'r'}`
  //     })
  //     .join('/')
  //   return thisShape === otherShape
  // }
  // /** Static convenience wrapper for `isSame`. */
  // static isSame(a: AnyRoute | string | undefined, b: AnyRoute | string | undefined): boolean {
  //   if (!a) {
  //     if (!b) return true
  //     return false
  //   }
  //   if (!b) {
  //     return false
  //   }
  //   return Route0.create(a).isSame(Route0.create(b))
  // }

  // /** True when current route is more specific/deeper than `other`. */
  // isDescendant(other: AnyRoute | string | undefined): boolean {
  //   if (!other) return false
  //   other = Route0.create(other)
  //   // this is a descendant of other if:
  //   // - paths are not exactly the same
  //   // - other's path is a prefix of this path, matching params as wildcards
  //   const getParts = (path: string) => (path === '/' ? ['/'] : path.split('/').filter(Boolean))
  //   // Root is ancestor of any non-root; thus any non-root is a descendant of root
  //   if (other.definition === '/' && this.definition !== '/') {
  //     return true
  //   }
  //   const thisParts = getParts(this.definition)
  //   const otherParts = getParts(other.definition)

  //   // A descendant must be deeper
  //   if (thisParts.length <= otherParts.length) return false

  //   const matchesPatternPart = (patternPart: string, valuePart: string): { match: boolean; wildcard: boolean } => {
  //     if (patternPart.startsWith(':')) return { match: true, wildcard: false }
  //     const wildcardIndex = patternPart.indexOf('*')
  //     if (wildcardIndex >= 0) {
  //       const prefix = patternPart.slice(0, wildcardIndex)
  //       return { match: prefix.length === 0 || valuePart.startsWith(prefix), wildcard: true }
  //     }
  //     return { match: patternPart === valuePart, wildcard: false }
  //   }

  //   for (let i = 0; i < otherParts.length; i++) {
  //     const otherPart = otherParts[i]
  //     const thisPart = thisParts[i]
  //     const result = matchesPatternPart(otherPart, thisPart)
  //     if (!result.match) return false
  //     if (result.wildcard) return true
  //   }
  //   // Not equal (depth already ensures not equal)
  //   return true
  // }

  // /** True when current route is broader/shallower than `other`. */
  // isAncestor(other: AnyRoute | string | undefined): boolean {
  //   if (!other) return false
  //   other = Route0.create(other)
  //   // this is an ancestor of other if:
  //   // - paths are not exactly the same
  //   // - this path is a prefix of other path, matching params as wildcards
  //   const getParts = (path: string) => (path === '/' ? ['/'] : path.split('/').filter(Boolean))
  //   // Root is ancestor of any non-root path
  //   if (this.definition === '/' && other.definition !== '/') {
  //     return true
  //   }
  //   const thisParts = getParts(this.definition)
  //   const otherParts = getParts(other.definition)

  //   // An ancestor must be shallower
  //   if (thisParts.length >= otherParts.length) return false

  //   const matchesPatternPart = (patternPart: string, valuePart: string): { match: boolean; wildcard: boolean } => {
  //     if (patternPart.startsWith(':')) return { match: true, wildcard: false }
  //     const wildcardIndex = patternPart.indexOf('*')
  //     if (wildcardIndex >= 0) {
  //       const prefix = patternPart.slice(0, wildcardIndex)
  //       return { match: prefix.length === 0 || valuePart.startsWith(prefix), wildcard: true }
  //     }
  //     return { match: patternPart === valuePart, wildcard: false }
  //   }

  //   for (let i = 0; i < thisParts.length; i++) {
  //     const thisPart = thisParts[i]
  //     const otherPart = otherParts[i]
  //     const result = matchesPatternPart(thisPart, otherPart)
  //     if (!result.match) return false
  //     if (result.wildcard) return true
  //   }
  //   // Not equal (depth already ensures not equal)
  //   return true
  // }

  /** True when two route patterns can match the same concrete URL. */
  isOverlap(other: AnyRoute | string | undefined): boolean {
    if (!other) return false
    const otherRoute = Route0.from(other) as Route0<string, UnknownSearchInput>
    const thisRegex = this.regex
    const otherRegex = otherRoute.regex
    const thisCandidates = this.routePatternCandidates
    const otherCandidates = otherRoute.routePatternCandidates
    if (thisCandidates.some((path) => otherRegex.test(path))) return true
    if (otherCandidates.some((path) => thisRegex.test(path))) return true
    return false
  }

  /**
   * True when overlap is not resolvable by route ordering inside one route set.
   *
   * Overlapping routes are resolvable when one is uniformly more specific than the other across every shared segment
   * (e.g. `/users/impersonate/:id?` dominates `/users/:sn`, so it can simply be ordered first). A real conflict only
   * happens when specificity _crosses_ — each side wins some segment (e.g. `/:x/:id` vs `/x/:sn?`) — or when both
   * routes have equal specificity at the same depth (e.g. `/x/:id` vs `/x/:sn`).
   */
  isConflict(other: AnyRoute | string | undefined): boolean {
    if (!other) return false
    const otherRoute = Route0.from(other) as Route0<string, UnknownSearchInput>
    if (!this.isOverlap(otherRoute)) return false
    const thisParts = Route0._specificityParts(this.definition)
    const otherParts = Route0._specificityParts(otherRoute.definition)
    let thisMoreSpecific = false
    let otherMoreSpecific = false
    for (let i = 0; i < Math.min(thisParts.length, otherParts.length); i++) {
      const thisRank = Route0._partRank(thisParts[i])
      const otherRank = Route0._partRank(otherParts[i])
      if (thisRank > otherRank) thisMoreSpecific = true
      else if (thisRank < otherRank) otherMoreSpecific = true
    }
    // Specificity crosses: each side wins some segment => unresolvable by ordering.
    if (thisMoreSpecific && otherMoreSpecific) return true
    // One side is uniformly more specific => strict subset => resolvable by ordering.
    if (thisMoreSpecific || otherMoreSpecific) return false
    // Equal specificity in the shared region: only same-depth routes are real conflicts
    // (equal "languages"); different depth means a strict subset that ordering resolves.
    return thisParts.length === otherParts.length
  }

  /** Specificity comparator used for deterministic route ordering. */
  isMoreSpecificThan(other: AnyRoute | string | undefined): boolean {
    if (!other) return false
    other = Route0.create(other)
    return Route0._compareSpecificity(this.definition, other.definition) < 0
  }
}

/**
 * Typed route collection with deterministic matching order.
 *
 * `Routes.create()` accepts either plain string definitions or route objects and returns a "pretty" object with direct
 * route access + helper methods under `._`.
 */

export class Routes<const T extends RoutesRecord = any> {
  _routes: RoutesRecordHydrated<T>
  _pathsOrdering: string[]
  _keysOrdering: string[]
  _ordered: CallableRoute[]

  _: {
    routes: Routes<T>['_routes']
    getLocation: Routes<T>['_getLocation']
    clone: Routes<T>['_clone']
    pathsOrdering: Routes<T>['_pathsOrdering']
    keysOrdering: Routes<T>['_keysOrdering']
    ordered: Routes<T>['_ordered']
  }

  private constructor({
    routes,
    isHydrated = false,
    pathsOrdering,
    keysOrdering,
    ordered,
  }: {
    routes: RoutesRecordHydrated<T> | T
    isHydrated?: boolean
    pathsOrdering?: string[]
    keysOrdering?: string[]
    ordered?: CallableRoute[]
  }) {
    this._routes = (
      isHydrated ? (routes as RoutesRecordHydrated<T>) : Routes.hydrate(routes)
    ) as RoutesRecordHydrated<T>
    if (!pathsOrdering || !keysOrdering || !ordered) {
      const ordering = Routes.makeOrdering(this._routes)
      this._pathsOrdering = ordering.pathsOrdering
      this._keysOrdering = ordering.keysOrdering
      this._ordered = this._keysOrdering.map((key) => this._routes[key])
    } else {
      this._pathsOrdering = pathsOrdering
      this._keysOrdering = keysOrdering
      this._ordered = ordered
    }
    this._ = {
      routes: this._routes,
      getLocation: this._getLocation.bind(this),
      clone: this._clone.bind(this),
      pathsOrdering: this._pathsOrdering,
      keysOrdering: this._keysOrdering,
      ordered: this._ordered,
    }
  }

  /** Creates and hydrates a typed routes collection. */
  static create<const T extends RoutesRecord>(routes: T, override?: RouteConfigInput): RoutesPretty<T> {
    const result = Routes.prettify(new Routes({ routes }))
    if (!override) {
      return result
    }
    return result._.clone(override)
  }

  private static prettify<const T extends RoutesRecord>(instance: Routes<T>): RoutesPretty<T> {
    Object.setPrototypeOf(instance, Routes.prototype)
    Object.defineProperty(instance, Symbol.toStringTag, {
      value: 'Routes',
    })
    Object.assign(instance, {
      clone: instance._clone.bind(instance),
    })
    Object.assign(instance, instance._routes)
    return instance as unknown as RoutesPretty<T>
  }

  private static hydrate<const T extends RoutesRecord>(routes: T): RoutesRecordHydrated<T> {
    const result = {} as RoutesRecordHydrated<T>
    for (const key in routes) {
      if (Object.hasOwn(routes, key)) {
        const value = routes[key]
        result[key] = (typeof value === 'string' ? Route0.create(value) : value) as CallableRoute<T[typeof key]>
      }
    }
    return result
  }

  /**
   * Matches an input URL against collection routes.
   *
   * Returns first exact match according to precomputed ordering, otherwise returns `UnknownLocation`.
   */
  _getLocation(href: `${string}://${string}`): UnknownLocation | ExactLocation
  _getLocation(hrefRel: `/${string}`): UnknownLocation | ExactLocation
  _getLocation(hrefOrHrefRel: string): UnknownLocation | ExactLocation
  _getLocation(location: AnyLocation): UnknownLocation | ExactLocation
  _getLocation(url: URL): UnknownLocation | ExactLocation
  _getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): UnknownLocation | ExactLocation
  _getLocation(hrefOrHrefRelOrLocation: string | AnyLocation | URL): UnknownLocation | ExactLocation {
    const input = hrefOrHrefRelOrLocation
    const location = Route0.getLocation(input)
    for (const route of this._ordered) {
      if (route.isExact(location.pathname, false)) {
        const relation = route.getRelation(input)
        return Object.assign(location, {
          route: route.definition,
          params: relation.params,
        }) as ExactLocation
      }
    }
    return location as UnknownLocation
  }

  private static makeOrdering(routes: RoutesRecord): {
    pathsOrdering: string[]
    keysOrdering: string[]
  } {
    const hydrated = Routes.hydrate(routes)
    const entries = Object.entries(hydrated)

    // Single transitive specificity order: more specific first, deterministic regardless of insertion order. A mixed
    // comparator (specificity for overlaps, depth otherwise) is non-transitive and lets `Array.sort` mis-order
    // overlapping routes, which would route a URL to the wrong page. `isMoreSpecificThan` is a total order, so deriving
    // the comparator from it stays transitive.
    entries.sort(([_keyA, routeA], [_keyB, routeB]) => {
      if (routeA.isMoreSpecificThan(routeB)) return -1
      if (routeB.isMoreSpecificThan(routeA)) return 1
      return 0
    })

    const pathsOrdering = entries.map(([_key, route]) => route.definition)
    const keysOrdering = entries.map(([_key]) => _key)
    return { pathsOrdering, keysOrdering }
  }

  /** Returns a cloned routes collection with config applied to each route. */
  _clone(config: RouteConfigInput): RoutesPretty<T> {
    const newRoutes = {} as RoutesRecordHydrated<T>
    for (const key in this._routes) {
      if (Object.hasOwn(this._routes, key)) {
        newRoutes[key] = this._routes[key].clone(config) as CallableRoute<T[typeof key]>
      }
    }
    const instance = new Routes({
      routes: newRoutes,
      isHydrated: true,
      pathsOrdering: this._pathsOrdering,
      keysOrdering: this._keysOrdering,
      ordered: this._keysOrdering.map((key) => newRoutes[key]),
    })
    return Routes.prettify(instance)
  }

  static _ = {
    prettify: Routes.prettify.bind(Routes),
    hydrate: Routes.hydrate.bind(Routes),
    makeOrdering: Routes.makeOrdering.bind(Routes),
  }
}

// main

/** Any route instance shape, preserving literal path type when known. */
export type AnyRoute<
  T extends Route0<string> | string = string,
  TSearch extends UnknownSearchInput = UnknownSearchInput,
> = T extends string ? Route0<T, TSearch> : T
/**
 * Callable route (`route(input)`) plus route instance methods/properties.
 *
 * Distributes over `T` so that `CallableRoute<'/a' | '/b'>` is a union of per-route intersections, not an intersection
 * of two unions — the latter normalizes as a cross-product (N routes → N² union members) and trips TS2590 ("union type
 * too complex") around ~316 routes when a routes map is indexed by a generic key.
 */
export type CallableRoute<
  T extends Route0<string> | string = string,
  TSearch extends UnknownSearchInput = UnknownSearchInput,
> = T extends unknown ? AnyRoute<T, TSearch> & AnyRoute<T, TSearch>['get'] : never
/** Route input accepted by most APIs: definition string or route object/callable. */
export type AnyRouteOrDefinition<T extends string = string> = AnyRoute<T> | CallableRoute<T> | T
/** Route-level runtime configuration. */
export type RouteConfigInput = {
  origin?: string
}

/** Per-call options for `route.get()` / `route.abs()`. */
export type RouteGetOptions = {
  /**
   * Absolute URL origin. `true` uses the route's configured origin, a string overrides it, `false`/omitted keeps the
   * path relative. (`route.abs()` defaults this to `true`.)
   */
  origin?: boolean | string
  /**
   * Percent-encodes path param values and the search string (`true`, default). Set to `false` for a prettier,
   * human-readable URL — note that unencoded values may be ambiguous if they contain `/`, `&`, `=` or `?`.
   */
  encode?: boolean
}

// collection

/** User-provided routes map (plain definitions or route instances). */
export type RoutesRecord = Record<string, AnyRoute | string>
/** Same as `RoutesRecord` but all values normalized to callable routes. */
export type RoutesRecordHydrated<TRoutesRecord extends RoutesRecord = any> = {
  [K in keyof TRoutesRecord]: CallableRoute<TRoutesRecord[K]>
}
/** Public shape returned by `Routes.create()`. Default `any` so `satisfies RoutesPretty` accepts any created routes. */
export type RoutesPretty<TRoutesRecord extends RoutesRecord = any> = RoutesRecordHydrated<TRoutesRecord> &
  Omit<Routes<TRoutesRecord>, '_routes' | '_getLocation' | '_clone' | '_pathsOrdering' | '_keysOrdering' | '_ordered'>
export type ExtractRoutesKeys<TRoutes extends RoutesPretty | RoutesRecord> = TRoutes extends RoutesPretty
  ? Extract<keyof TRoutes['_']['routes'], string>
  : TRoutes extends RoutesRecord
    ? Extract<keyof TRoutes, string>
    : never
export type ExtractRoute<
  TRoutes extends RoutesPretty | RoutesRecord,
  TKey extends ExtractRoutesKeys<TRoutes>,
> = TRoutes extends RoutesPretty ? TRoutes['_']['routes'][TKey] : TRoutes extends RoutesRecord ? TRoutes[TKey] : never

// public utils

export type Definition<T extends AnyRoute | string> = T extends AnyRoute
  ? T['definition']
  : T extends string
    ? T
    : never
export type ParamsDefinition<T extends AnyRoute | string> = T extends AnyRoute
  ? T['params']
  : T extends string
    ? _ParamsDefinition<T>
    : undefined
export type Extended<
  T extends AnyRoute | string | undefined,
  TSuffixDefinition extends string,
  TSearchInput extends UnknownSearchInput = UnknownSearchInput,
> = T extends AnyRoute
  ? Route0<PathExtended<T['definition'], TSuffixDefinition>, TSearchInput>
  : T extends string
    ? Route0<PathExtended<T, TSuffixDefinition>, TSearchInput>
    : T extends undefined
      ? Route0<TSuffixDefinition, TSearchInput>
      : never

// export type IsAncestor<T extends AnyRoute | string, TAncestor extends AnyRoute | string> = _IsAncestor<
//   Definition<T>,
//   Definition<TAncestor>
// >
// export type IsDescendant<T extends AnyRoute | string, TDescendant extends AnyRoute | string> = _IsDescendant<
//   Definition<T>,
//   Definition<TDescendant>
// >
// export type IsSame<T extends AnyRoute | string, TExact extends AnyRoute | string> = _IsSame<
//   Definition<T>,
//   Definition<TExact>
// >
export type IsSameParams<T1 extends AnyRoute | string, T2 extends AnyRoute | string> = _IsSameParams<
  ParamsDefinition<T1>,
  ParamsDefinition<T2>
>

export type HasParams<T extends AnyRoute | string> = keyof _ParamsDefinition<Definition<T>> extends never ? false : true
export type HasWildcard<T extends AnyRoute | string> = Definition<T> extends `${string}*${string}` ? true : false
export type HasRequiredParams<T extends AnyRoute | string> =
  _RequiredParamKeys<Definition<T>> extends never ? false : true

export type ParamsOutput<T extends AnyRoute | string> = {
  [K in keyof ParamsDefinition<T>]: ParamsDefinition<T>[K] extends true ? string : string | undefined
}
export type ParamsInput<T extends AnyRoute | string = string> = _ParamsInput<Definition<T>>
export type IsParamsOptional<T extends AnyRoute | string> = HasRequiredParams<Definition<T>> extends true ? false : true
export type ParamsInputStringOnly<T extends AnyRoute | string = string> = _ParamsInputStringOnly<Definition<T>>

// relation

export type ExactRouteRelation<TRoute extends AnyRoute | string = AnyRoute | string> = {
  type: 'exact'
  route: Definition<TRoute>
  params: ParamsOutput<TRoute>
  exact: true
  ancestor: false
  descendant: false
  unmatched: false
}
export type AncestorRouteRelation<TRoute extends AnyRoute | string = AnyRoute | string> = {
  type: 'ancestor'
  route: Definition<TRoute>
  params: ParamsOutput<TRoute>
  exact: false
  ancestor: true
  descendant: false
  unmatched: false
}
export type DescendantRouteRelation<TRoute extends AnyRoute | string = AnyRoute | string> = {
  type: 'descendant'
  route: Definition<TRoute>
  params: Partial<ParamsOutput<TRoute>>
  exact: false
  ancestor: false
  descendant: true
  unmatched: false
}
export type UnmatchedRouteRelation<TRoute extends AnyRoute | string = AnyRoute | string> = {
  type: 'unmatched'
  route: Definition<TRoute>
  params: Record<never, never>
  exact: false
  ancestor: false
  descendant: false
  unmatched: true
}
export type RouteRelation<TRoute extends AnyRoute | string = AnyRoute | string> =
  | ExactRouteRelation<TRoute>
  | AncestorRouteRelation<TRoute>
  | DescendantRouteRelation<TRoute>
  | UnmatchedRouteRelation<TRoute>

// location

export type LocationParams<TDefinition extends string> = {
  [K in keyof _ParamsDefinition<TDefinition>]: _ParamsDefinition<TDefinition>[K] extends true
    ? string
    : string | undefined
}

/**
 * URL location primitives independent from route-matching state.
 *
 * `hrefRel` is relative href and includes `pathname + search + hash`.
 */
export type _GeneralLocation = {
  /**
   * Path without search/hash (normalized for trailing slash).
   *
   * Example:
   *
   * - input: `https://example.com/users/42?tab=posts#section`
   * - pathname: `/users/42`
   */
  pathname: string
  /**
   * Parsed query object.
   *
   * Example:
   *
   * - `{ tab: "posts", sort: "desc" }`
   */
  search: UnknownSearchParsed
  /**
   * Raw query string with leading `?`, if present, else empty string.
   *
   * Example:
   *
   * - `?tab=posts&sort=desc`
   */
  searchString: string
  /**
   * Raw hash with leading `#`, if present, else empty string.
   *
   * Example:
   *
   * - `#section`
   */
  hash: string
  /**
   * URL origin for absolute inputs.
   *
   * Example:
   *
   * - href: `https://example.com/users/42`
   * - origin: `https://example.com`
   */
  origin: string | undefined
  /**
   * Full absolute href for absolute inputs.
   *
   * Example:
   *
   * - `https://example.com/users/42?tab=posts#section`
   */
  href: string | undefined
  /**
   * Relative href (`pathname + search + hash`).
   *
   * Example:
   *
   * - pathname: `/users/42`
   * - search: `?tab=posts`
   * - hash: `#section`
   * - hrefRel: `/users/42?tab=posts#section`
   */
  hrefRel: string
  /**
   * Whether input was absolute URL.
   *
   * Examples:
   *
   * - `https://example.com/users/42` -> `true`
   * - `/users/42` -> `false`
   */
  abs: boolean
  port: string | undefined
  host: string | undefined
  hostname: string | undefined
}
/** Location state before matching against a concrete route. */
export type UnknownLocationState = {
  route: undefined
  params: undefined
}
export type UnknownLocation = _GeneralLocation & UnknownLocationState

/** Exact match state for a known route. */
export type ExactLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: Definition<TRoute>
  params: ParamsOutput<TRoute>
}
export type ExactLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  ExactLocationState<TRoute>

export type UnknownSearchParsedValue = string | UnknownSearchParsed | Array<UnknownSearchParsedValue>
export interface UnknownSearchParsed {
  [key: string]: UnknownSearchParsedValue
}

export type UnknownSearchInput = Record<string, unknown>

/** Input URL is a descendant of route definition (route is ancestor). */
export type AncestorLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: IsAny<TRoute> extends true ? any : ParamsOutput<TRoute> & { [key: string]: string | undefined }
}
export type AncestorLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  AncestorLocationState<TRoute>

/** It is when route not match at all, but params match. */
export type WeakAncestorLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: IsAny<TRoute> extends true ? any : ParamsOutput<TRoute> & { [key: string]: string | undefined }
}
export type WeakAncestorLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  WeakAncestorLocationState<TRoute>

/** Input URL is an ancestor prefix of route definition (route is descendant). */
export type DescendantLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: Partial<ParamsOutput<TRoute>>
}
export type DescendantLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  DescendantLocationState<TRoute>

/** It is when route not match at all, but params partially match. */
export type WeakDescendantLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: Partial<ParamsOutput<TRoute>>
}
export type WeakDescendantLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  WeakDescendantLocationState<TRoute>
export type KnownLocation<TRoute extends AnyRoute | string = AnyRoute | string> =
  | ExactLocation<TRoute>
  | AncestorLocation<TRoute>
  | WeakAncestorLocation<TRoute>
  | DescendantLocation<TRoute>
  | WeakDescendantLocation<TRoute>
export type AnyLocation<TRoute extends AnyRoute | string = AnyRoute | string> = UnknownLocation | KnownLocation<TRoute>

// internal utils

export type _ParamsDefinition<TDefinition extends string> = _ExtractParamsDefinitionBySegments<
  _SplitPathSegments<Definition<TDefinition>>
>

export type _Simplify<T> = { [K in keyof T]: T[K] } & {}
export type _IfNoKeys<T extends object, TYes, TNo> = keyof T extends never ? TYes : TNo

export type _ParamsInput<TDefinition extends string> =
  _ParamsDefinition<TDefinition> extends infer TDef extends Record<string, boolean>
    ? _IfNoKeys<
        TDef,
        Record<never, never>,
        _Simplify<
          {
            [K in keyof TDef as TDef[K] extends true ? K : never]: string | number
          } & {
            [K in keyof TDef as TDef[K] extends false ? K : never]?: string | number | undefined
          }
        >
      >
    : Record<never, never>

export type _ParamsInputStringOnly<TDefinition extends string> =
  _ParamsDefinition<TDefinition> extends infer TDef extends Record<string, boolean>
    ? _IfNoKeys<
        TDef,
        Record<never, never>,
        _Simplify<
          {
            [K in keyof TDef as TDef[K] extends true ? K : never]: string
          } & {
            [K in keyof TDef as TDef[K] extends false ? K : never]?: string | undefined
          }
        >
      >
    : Record<never, never>

export type _SplitPathSegments<TPath extends string> = TPath extends ''
  ? []
  : TPath extends '/'
    ? []
    : TPath extends `/${infer Rest}`
      ? _SplitPathSegments<Rest>
      : TPath extends `${infer Segment}/${infer Rest}`
        ? Segment extends ''
          ? _SplitPathSegments<Rest>
          : [Segment, ..._SplitPathSegments<Rest>]
        : TPath extends ''
          ? []
          : [TPath]

export type _ParamDefinitionFromSegment<TSegment extends string> = TSegment extends `:${infer Name}?`
  ? { [K in Name]: false }
  : TSegment extends `:${infer Name}`
    ? { [K in Name]: true }
    : TSegment extends `${string}*?`
      ? { '*': false }
      : TSegment extends `${string}*`
        ? { '*': true }
        : Record<never, never>

export type _MergeParamDefinitions<A extends Record<string, boolean>, B extends Record<string, boolean>> = {
  [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never
}

export type _ExtractParamsDefinitionBySegments<TSegments extends string[]> = TSegments extends [
  infer Segment extends string,
  ...infer Rest extends string[],
]
  ? _MergeParamDefinitions<_ParamDefinitionFromSegment<Segment>, _ExtractParamsDefinitionBySegments<Rest>>
  : Record<never, never>

export type _RequiredParamKeys<TDefinition extends string> = {
  [K in keyof _ParamsDefinition<TDefinition>]: _ParamsDefinition<TDefinition>[K] extends true ? K : never
}[keyof _ParamsDefinition<TDefinition>]
export type ReplacePathParams<S extends string> = S extends `${infer Head}:${infer Tail}`
  ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Tail extends `${infer _Param}/${infer Rest}`
    ? ReplacePathParams<`${Head}${string}/${Rest}`>
    : `${Head}${string}`
  : S
export type DedupeSlashes<S extends string> = S extends `${infer A}//${infer B}` ? DedupeSlashes<`${A}/${B}`> : S
export type EnsureLeadingSlash<S extends string> = S extends '' ? '/' : S extends `/${string}` ? S : `/${S}`
export type TrimTrailingSlash<S extends string> = S extends '/'
  ? '/'
  : S extends `${infer V}/`
    ? TrimTrailingSlash<V>
    : S
export type NormalizeRouteDefinition<S extends string> = TrimTrailingSlash<EnsureLeadingSlash<DedupeSlashes<S>>>
export type EmptyRecord = Record<never, never>
export type JoinPath<Parent extends string, Suffix extends string> = NormalizeRouteDefinition<
  Definition<Parent> extends infer A extends string
    ? Definition<Suffix> extends infer B extends string
      ? NormalizeRouteDefinition<A> extends infer ANormalized extends string
        ? NormalizeRouteDefinition<B> extends infer BNormalized extends string
          ? BNormalized extends '/'
            ? ANormalized
            : ANormalized extends '/'
              ? BNormalized
              : `${ANormalized}/${BNormalized}`
          : never
        : never
      : never
    : never
>
export type PathExtended<
  TSourceDefinitionDefinition extends string,
  TSuffixDefinitionDefinition extends string,
> = `${NormalizeRouteDefinition<JoinPath<StripTrailingWildcard<TSourceDefinitionDefinition>, TSuffixDefinitionDefinition>>}`

export type StripTrailingWildcard<TDefinition extends string> = TDefinition extends `${infer TPath}*?`
  ? NormalizeRouteDefinition<TPath>
  : TDefinition extends `${infer TPath}*`
    ? NormalizeRouteDefinition<TPath>
    : NormalizeRouteDefinition<TDefinition>

export type OnlyIfNoParams<TRoute extends AnyRoute | string, Yes, No = never> =
  HasParams<TRoute> extends false ? Yes : No
export type OnlyIfHasParams<TRoute extends AnyRoute | string, Yes, No = never> =
  HasParams<TRoute> extends true ? Yes : No

export type GetPathInput<
  TDefinition extends string,
  TSearchInput extends UnknownSearchInput,
> = _ParamsInput<TDefinition> & {
  '?'?: TSearchInput
  '#'?: string | number
}
export type GetPathInputByRoute<TRoute extends AnyRoute | CallableRoute | string> =
  TRoute extends AnyRoute<any, infer TSearchInput>
    ? GetPathInput<Definition<TRoute>, TSearchInput>
    : TRoute extends string
      ? GetPathInput<TRoute, UnknownSearchInput>
      : never

export type IsAny<T> = 0 extends 1 & T ? true : false

export type _IsSameParams<T1 extends object | undefined, T2 extends object | undefined> = T1 extends undefined
  ? T2 extends undefined
    ? true
    : false
  : T2 extends undefined
    ? false
    : T1 extends T2
      ? T2 extends T1
        ? true
        : false
      : false

// export type _IsAncestor<T extends string, TAncestor extends string> = T extends TAncestor
//   ? false
//   : T extends `${TAncestor}${string}`
//     ? true
//     : false
// export type _IsDescendant<T extends string, TDescendant extends string> = TDescendant extends T
//   ? false
//   : TDescendant extends `${T}${string}`
//     ? true
//     : false
// export type _IsSame<T extends string, TExact extends string> = T extends TExact
//   ? TExact extends T
//     ? true
//     : false
//   : false

export type _SafeParseInputResult<TInputParsed extends Record<string, unknown>> =
  | {
      success: true
      data: TInputParsed
      error: undefined
    }
  | {
      success: false
      data: undefined
      error: Error
    }

export type SchemaRoute0<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
> = StandardSchemaV1<TInput, TOutput> &
  StandardJSONSchemaV1<TInput, TOutput> & {
    parse: (input: unknown) => TOutput
    safeParse: (input: unknown) => _SafeParseInputResult<TOutput>
  }
