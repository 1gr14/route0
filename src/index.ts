import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { parse as parseSearchQuery, stringify as stringifySearchQuery } from '@1gr14/flat'

/** A tail param riding after a one-character delimiter on a param segment (`:slug.:ext`) or a wildcard (`*.:ext`). */
export type RouteTokenTail = {
  name: string
  optional: boolean
  values?: readonly string[]
  type?: ParamTypeName
  delimiter: string
}

export type RouteToken =
  | { kind: 'static'; value: string }
  | {
      kind: 'param'
      name: string
      optional: boolean
      values?: readonly string[]
      type?: ParamTypeName
      /** Literal text around the param inside its segment (`x-:id.png`); absent for a whole-segment param. */
      prefix?: string
      suffix?: string
      tail?: RouteTokenTail
    }
  | { kind: 'wildcard'; prefix: string; optional: boolean; suffix?: string; tail?: RouteTokenTail }

/** A token that consumes exactly one path segment — everything a wildcard is not. */
type _SegmentToken = Exclude<RouteToken, { kind: 'wildcard' }>

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const collapseDuplicateSlashes = (value: string): string => value.replace(/\/{2,}/g, '/')

// param types
//
// Every typed param matches only the CANONICAL string form of its value (no leading zeros, no '+', no exponents, no
// trailing fraction zeros, no '-0'), which keeps building and parsing a bijection: every URL that matches parses to a
// value that builds back into the same URL. The one deliberate exception is `datetime` — see its entry.

/** The name a typed param carries in a definition (`:id[int]`), minus `str` which normalizes away. */
export type ParamTypeName =
  'bool' | 'int' | '-int' | 'num' | '-num' | 'bigint' | '-bigint' | 'uuid' | 'date' | 'datetime'

/**
 * The language (set of strings) a type matches, for overlap and specificity analysis. Types sharing a language are
 * indistinguishable by matching (`int` vs `bigint`), which `isConflict` reports.
 */
type _ParamTypeLang = 'bool' | 'nat' | 'zint' | 'dec' | 'zdec' | 'uuid' | 'date' | 'datetime'

/**
 * Every language's proper supersets. Only the numeric chain has non-trivial nesting: nat ⊂ zint, nat ⊂ dec ⊂ zdec, zint
 * ⊂ zdec. The one crossing pair (overlap without nesting) is zint × dec — they share nat.
 */
const _LANG_SUPERSETS: Record<_ParamTypeLang, readonly _ParamTypeLang[]> = {
  bool: [],
  nat: ['zint', 'dec', 'zdec'],
  zint: ['zdec'],
  dec: ['zdec'],
  zdec: [],
  uuid: [],
  date: [],
  datetime: [],
}

/** How two type languages relate. `crossing` = overlap without nesting (each side owns values the other lacks). */
type _LangRelation = 'equal' | 'subset' | 'superset' | 'disjoint' | 'crossing'

const _langRelation = (a: _ParamTypeLang, b: _ParamTypeLang): _LangRelation => {
  if (a === b) return 'equal'
  if (_LANG_SUPERSETS[a].includes(b)) return 'subset'
  if (_LANG_SUPERSETS[b].includes(a)) return 'superset'
  if ((a === 'zint' && b === 'dec') || (a === 'dec' && b === 'zint')) return 'crossing'
  return 'disjoint'
}

const _UUID_REGEX_BODY = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
// Month-aware: 31-day months take 01-31, 30-day months 01-30, February 01-29. The one hole left is Feb 29 of a
// non-leap year — it matches, and what it parses to is engine-dependent (an Invalid Date per spec on V8; JSC rolls
// it over to March 1). Both schemas reject the string form via their round-trip gate; full Gregorian validation in a
// regex is a monster.
const _DATE_REGEX_BODY =
  '\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|[12]\\d))'
// The match regex runs against the still-encoded pathname, where a client may legally send ':' as '%3A' and '+' as
// '%2B' — both spellings of the same URL must match.
const _COLON = '(?::|%3[Aa])'
const _PLUS = '(?:\\+|%2[Bb])'
const _TIME_REGEX_BODY = `(?:[01]\\d|2[0-3])${_COLON}[0-5]\\d(?:${_COLON}[0-5]\\d(?:\\.\\d{1,3})?)?`
const _TZ_REGEX_BODY = `(?:Z|(?:${_PLUS}|-)(?:[01]\\d|2[0-3])${_COLON}[0-5]\\d)`

const _NAT_REGEX_BODY = '0|[1-9]\\d*'
const _ZINT_REGEX_BODY = '0|-?[1-9]\\d*'
const _DEC_REGEX_BODY = '(?:0|[1-9]\\d*)(?:\\.\\d*[1-9])?'
const _ZDEC_REGEX_BODY = `${_DEC_REGEX_BODY}|-(?:0\\.\\d*[1-9]|[1-9]\\d*(?:\\.\\d*[1-9])?)`

const _pad = (value: number, width: number): string => String(value).padStart(width, '0')

type _ParamTypeSpec = {
  /** Regex body matching exactly the canonical (still-encoded) forms of the type. Wrapped non-capturing by callers. */
  regexBody: string
  lang: _ParamTypeLang
  /** What `get()` and the schema accept, for error messages. */
  inputLabel: string
  /** Runtime check of an input value's JS type (shape only — canonicality is checked via serialize + regex). */
  checkInput: (value: unknown) => boolean
  /** Decoded matched string → typed value. Assumes the string matched `regexBody`. */
  parse: (decoded: string) => unknown
  /** Typed value → canonical string. Assumes `checkInput` passed; may still produce a non-canonical string. */
  serialize: (value: unknown) => string
  jsonSchemaInput: Record<string, unknown>
  jsonSchemaOutput: Record<string, unknown>
}

const _serializeDate = (value: unknown): string => {
  const date = value as Date
  return `${_pad(date.getUTCFullYear(), 4)}-${_pad(date.getUTCMonth() + 1, 2)}-${_pad(date.getUTCDate(), 2)}`
}

const PARAM_TYPES: Record<ParamTypeName, _ParamTypeSpec> = {
  bool: {
    regexBody: 'true|false',
    lang: 'bool',
    inputLabel: 'boolean',
    checkInput: (value) => typeof value === 'boolean',
    parse: (decoded) => decoded === 'true',
    serialize: String,
    jsonSchemaInput: { type: 'boolean' },
    jsonSchemaOutput: { type: 'boolean' },
  },
  int: {
    regexBody: _NAT_REGEX_BODY,
    lang: 'nat',
    inputLabel: 'number',
    checkInput: (value) => typeof value === 'number',
    parse: Number,
    serialize: String,
    jsonSchemaInput: { type: 'integer', minimum: 0 },
    jsonSchemaOutput: { type: 'integer', minimum: 0 },
  },
  '-int': {
    regexBody: _ZINT_REGEX_BODY,
    lang: 'zint',
    inputLabel: 'number',
    checkInput: (value) => typeof value === 'number',
    parse: Number,
    serialize: String,
    jsonSchemaInput: { type: 'integer' },
    jsonSchemaOutput: { type: 'integer' },
  },
  num: {
    regexBody: _DEC_REGEX_BODY,
    lang: 'dec',
    inputLabel: 'number',
    checkInput: (value) => typeof value === 'number',
    parse: Number,
    serialize: String,
    jsonSchemaInput: { type: 'number', minimum: 0 },
    jsonSchemaOutput: { type: 'number', minimum: 0 },
  },
  '-num': {
    regexBody: _ZDEC_REGEX_BODY,
    lang: 'zdec',
    inputLabel: 'number',
    checkInput: (value) => typeof value === 'number',
    parse: Number,
    serialize: String,
    jsonSchemaInput: { type: 'number' },
    jsonSchemaOutput: { type: 'number' },
  },
  bigint: {
    regexBody: _NAT_REGEX_BODY,
    lang: 'nat',
    inputLabel: 'bigint',
    checkInput: (value) => typeof value === 'bigint',
    parse: BigInt,
    serialize: String,
    // JSON has no bigint — `integer` is the honest serialized shape (documented gap, like Date below).
    jsonSchemaInput: { type: 'integer', minimum: 0 },
    jsonSchemaOutput: { type: 'integer', minimum: 0 },
  },
  '-bigint': {
    regexBody: _ZINT_REGEX_BODY,
    lang: 'zint',
    inputLabel: 'bigint',
    checkInput: (value) => typeof value === 'bigint',
    parse: BigInt,
    serialize: String,
    jsonSchemaInput: { type: 'integer' },
    jsonSchemaOutput: { type: 'integer' },
  },
  uuid: {
    regexBody: _UUID_REGEX_BODY,
    lang: 'uuid',
    inputLabel: 'string',
    checkInput: (value) => typeof value === 'string',
    parse: (decoded) => decoded,
    serialize: (value) => value as string,
    jsonSchemaInput: { type: 'string', format: 'uuid' },
    jsonSchemaOutput: { type: 'string', format: 'uuid' },
  },
  date: {
    regexBody: _DATE_REGEX_BODY,
    lang: 'date',
    inputLabel: 'Date',
    checkInput: (value) => value instanceof Date,
    // A date-only ISO string is UTC midnight per the JS spec, and serialize reads UTC components back — symmetric
    // and machine-independent. (`new Date(2026, 7, 26)` is a LOCAL midnight; the docs warn about it.)
    parse: (decoded) => new Date(decoded),
    serialize: _serializeDate,
    // Runtime value is a Date; the schema describes its serialized form (same documented gap as bigint).
    jsonSchemaInput: { type: 'string', format: 'date' },
    jsonSchemaOutput: { type: 'string', format: 'date' },
  },
  datetime: {
    // The deliberate bijection exception: parsing is lenient (Z or ±HH:MM offset, optional seconds/ms — a Date holds
    // the exact instant either way), while building always emits the `toISOString()` canon. So URL → value is
    // many-to-one here; value → URL stays unique.
    regexBody: `${_DATE_REGEX_BODY}T${_TIME_REGEX_BODY}${_TZ_REGEX_BODY}`,
    lang: 'datetime',
    inputLabel: 'Date',
    checkInput: (value) => value instanceof Date,
    parse: (decoded) => new Date(decoded),
    serialize: (value) => (value as Date).toISOString(),
    jsonSchemaInput: { type: 'string', format: 'date-time' },
    jsonSchemaOutput: { type: 'string', format: 'date-time' },
  },
}

const PARAM_TYPE_NAMES = Object.keys(PARAM_TYPES) as ParamTypeName[]

/**
 * Which delimiter characters (`.`, `-`, `~`) can appear inside a type's canonical values. A tail param's language must
 * not contain its own delimiter — that is what keeps the body/tail split deterministic — so `:a-:d[date]` and
 * `:f.:v[num]` are rejected at creation. (`~` appears in no type, so it is compatible with everything.)
 */
const PARAM_TYPE_DELIMITER_CHARS: Record<ParamTypeName, string> = {
  bool: '',
  int: '',
  '-int': '-',
  num: '.',
  '-num': '.-',
  bigint: '',
  '-bigint': '-',
  uuid: '-',
  date: '-',
  datetime: '.-',
}

/**
 * True when two param-shaped constraints (enum values / type / plain) accept a common value. Plain intersects
 * everything; two enums must share a member; an enum meets a type when some value matches its regex; two types meet
 * exactly when their languages do.
 */
const _constraintsIntersect = (
  valuesA: readonly string[] | undefined,
  typeA: ParamTypeName | undefined,
  valuesB: readonly string[] | undefined,
  typeB: ParamTypeName | undefined,
): boolean => {
  if (valuesA && valuesB) return valuesA.some((value) => valuesB.includes(value))
  if (valuesA && typeB) return valuesA.some((value) => _typeMatches(typeB, value))
  if (valuesB && typeA) return valuesB.some((value) => _typeMatches(typeA, value))
  if (typeA && typeB) return _langRelation(PARAM_TYPES[typeA].lang, PARAM_TYPES[typeB].lang) !== 'disjoint'
  return true
}

type _ConstraintRelation = 'equal' | 'a-narrower' | 'b-narrower' | 'crossing' | 'disjoint'

/**
 * How two constraints' value sets relate — the subset/crossing analysis behind conflict detection and ordering. A
 * finite enum can only ever be narrower than (or disjoint/crossing with) an infinite type, never wider.
 */
const _constraintRelation = (
  valuesA: readonly string[] | undefined,
  typeA: ParamTypeName | undefined,
  valuesB: readonly string[] | undefined,
  typeB: ParamTypeName | undefined,
): _ConstraintRelation => {
  const aPlain = !valuesA && !typeA
  const bPlain = !valuesB && !typeB
  if (aPlain && bPlain) return 'equal'
  if (aPlain) return 'b-narrower'
  if (bPlain) return 'a-narrower'
  if (valuesA && valuesB) {
    const aInB = valuesA.every((value) => valuesB.includes(value))
    const bInA = valuesB.every((value) => valuesA.includes(value))
    if (aInB && bInA) return 'equal'
    if (aInB) return 'a-narrower'
    if (bInA) return 'b-narrower'
    return valuesA.some((value) => valuesB.includes(value)) ? 'crossing' : 'disjoint'
  }
  if (valuesA && typeB) {
    const matching = valuesA.filter((value) => _typeMatches(typeB, value)).length
    return matching === valuesA.length ? 'a-narrower' : matching > 0 ? 'crossing' : 'disjoint'
  }
  if (valuesB && typeA) {
    const matching = valuesB.filter((value) => _typeMatches(typeA, value)).length
    return matching === valuesB.length ? 'b-narrower' : matching > 0 ? 'crossing' : 'disjoint'
  }
  const relation = _langRelation(PARAM_TYPES[typeA as ParamTypeName].lang, PARAM_TYPES[typeB as ParamTypeName].lang)
  return relation === 'subset' ? 'a-narrower' : relation === 'superset' ? 'b-narrower' : relation
}

const _anchoredTypeRegexes = new Map<ParamTypeName, RegExp>()
/** Anchored full-match regex of a type, cached — used to test enum/static values and serialized outputs. */
const _typeMatches = (type: ParamTypeName, value: string): boolean => {
  let regex = _anchoredTypeRegexes.get(type)
  if (!regex) {
    regex = new RegExp(`^(?:${PARAM_TYPES[type].regexBody})$`)
    _anchoredTypeRegexes.set(type, regex)
  }
  return regex.test(value)
}

/**
 * Typed value → canonical string, or an error message (returned, not thrown — call sites own their error prefixes).
 *
 * The serialize-then-match-own-regex shape is the single canonicality gate: it rejects `1.5` for `int`, `-1` for `num`,
 * unsafe-integer `number`s (`1e21` serializes to `"1e+21"`), `NaN`/`Infinity`, and an Invalid Date (`toISOString`
 * throws) — uniformly, with no per-type checks.
 */
const _serializeParamValue = (type: ParamTypeName, value: unknown): { value: string } | { error: string } => {
  const spec = PARAM_TYPES[type]
  if (!spec.checkInput(value)) {
    return { error: `expected ${spec.inputLabel}, got ${value instanceof Date ? 'Date' : typeof value}` }
  }
  let serialized: string
  try {
    serialized = spec.serialize(value)
  } catch {
    return { error: `expected a valid ${spec.inputLabel}, got an invalid one` }
  }
  if (!_typeMatches(type, serialized)) {
    return { error: `expected [${type}] (canonical), got ${String(value)}` }
  }
  return { value: serialized }
}

// search declarations
//
// A definition may declare search params after the path: `/search&q&page[int]=0&sort(new|top)&tags[]&token!`.
// `&` is a DSL character — a literal `&` cannot appear in a static segment (same price `:` and `*` already paid).
// Search declarations never affect matching (pathname only) — they drive types, building, parsing and schemas.

/**
 * One search declaration: name, then optionally IN THIS ORDER — `[type]` or `(enum)`, `[]` (array), `!` (required),
 * `=default`. `!`+`=` contradict each other and `[]`+`=` is pointless (an absent array parses to `[]`) — both are
 * rejected by validation, as is an unknown type.
 */
const SEARCH_DECL_REGEX =
  /^([A-Za-z0-9_]+)(?:\[(-?[a-z]+)\]|\(([A-Za-z0-9_.~-]+(?:\|[A-Za-z0-9_.~-]+)*)\))?(\[\])?(!)?(?:=([A-Za-z0-9_.~-]+))?$/

type ParsedSearchDecl = {
  name: string
  typeName: string | undefined
  values: string[] | undefined
  array: boolean
  required: boolean
  /** Raw default from the definition — parsed into the typed value by `_buildSearchParamDefinition`. */
  defaultRaw: string | undefined
}

const parseSearchDecl = (decl: string): ParsedSearchDecl | undefined => {
  const match = decl.match(SEARCH_DECL_REGEX)
  if (!match) return undefined
  // casts: an unmatched optional group is undefined at runtime, which `noUncheckedIndexedAccess: false` hides
  return {
    name: match[1],
    typeName: match[2] as string | undefined,
    values: (match[3] as string | undefined)?.split('|'),
    array: match[4] === '[]',
    required: match[5] === '!',
    defaultRaw: match[6] as string | undefined,
  }
}

/**
 * Splits a definition into its path part and raw search declarations. The trailing `&` (loose mode) is reported
 * separately; `decls` are the non-empty chunks between the `&`s.
 */
const splitDefinition = (definition: string): { path: string; decls: string[]; loose: boolean; hasSearch: boolean } => {
  const amp = definition.indexOf('&')
  if (amp === -1) return { path: definition, decls: [], loose: false, hasSearch: false }
  const tail = definition.slice(amp + 1)
  return {
    path: definition.slice(0, amp),
    decls: tail.split('&').filter(Boolean),
    loose: tail === '' || tail.endsWith('&'),
    hasSearch: true,
  }
}

/**
 * The one and only param-segment grammar.
 *
 * `:name` · `:name?` · `:name(a|b)` · `:name[int]` — optionally wrapped in a literal prefix and/or suffix: `x-:name` ·
 * `img-:id[int].png` · `:file.mp4` · `v:major[int]?` — with the `?` always last, making the whole segment optional
 * (prefix and suffix drop out together with the value).
 *
 * A segment may also carry a TAIL param after a one-character delimiter from `.`, `~`, `-`:
 *
 * `:slug.:ext` · `:from-:to` · `:slug.:ext(md|txt)` · `v:major-:minor[int]` — at most two params, the tail always ends
 * the segment (no literal suffix after it), and the tail's values can never contain the delimiter (that is what makes
 * the split deterministic: it always lands on the LAST delimiter). Here the trailing `?` makes the TAIL optional —
 * `:slug.:ext?` matches `/talk.md` and `/talk`, the delimiter dropping out with the tail — while on a single-param
 * segment it still makes the whole segment optional. A fully-optional two-param segment is not expressible.
 *
 * An enum and a type are mutually exclusive; modifier order is fixed (enum/type, then suffix or tail, then `?`).
 * `[str]` is the explicit spelling of the default and normalizes away to a plain param. A name is a `[A-Za-z0-9_]+`
 * run, so a suffix/delimiter necessarily starts with one of `.`, `~`, `-` — `:idpng` is a name, not a name plus a
 * suffix.
 *
 * Prefix, suffix and constraint alternatives are URL-unreserved literals (`[A-Za-z0-9_.~-]`) so that the encoded and
 * decoded forms are identical — the match regex runs against the still-encoded pathname, while `getRelation` decodes
 * only afterwards. No regex metacharacters, no `/` (segments are split on it), no `*` (would confuse the wildcard
 * branch). Any `:` in a non-wildcard segment means param intent: what does not parse is rejected, never silently
 * downgraded to a static segment.
 */
const PARAM_SEGMENT_REGEX =
  /^([A-Za-z0-9_.~-]*):([A-Za-z0-9_]+)(?:\(([A-Za-z0-9_.~-]+(?:\|[A-Za-z0-9_.~-]+)*)\)|\[(-?[a-z]+)\])?(?:([.~-]):([A-Za-z0-9_]+)(?:\(([A-Za-z0-9_.~-]+(?:\|[A-Za-z0-9_.~-]+)*)\)|\[(-?[a-z]+)\])?|([A-Za-z0-9_.~-]*))(\?)?$/

/** The tail param of a two-param segment or of a wildcard (`*.{tail}`): what follows the one-character delimiter. */
type ParsedParamTail = {
  delimiter: string
  name: string
  values: string[] | undefined
  typeName: string | undefined
  optional: boolean
}

type ParsedParamSegment = {
  name: string
  values: string[] | undefined
  /** Raw type name from the definition, `str` included — validated (and `str` normalized away) by the caller. */
  typeName: string | undefined
  /** Literal segment text around the param; `''` for the classic whole-segment param. */
  prefix: string
  suffix: string
  /** Whole-segment optionality — always `false` when a tail is present (the `?` belongs to the tail there). */
  optional: boolean
  tail: ParsedParamTail | undefined
}

/** Parses one path segment as a param (possibly two). Returns `undefined` for anything that is not a param segment. */
const parseParamSegment = (segment: string): ParsedParamSegment | undefined => {
  const match = segment.match(PARAM_SEGMENT_REGEX)
  if (!match) return undefined
  // casts: an unmatched optional group is undefined at runtime, which `noUncheckedIndexedAccess: false` hides
  const optionalMark = match[10] === '?'
  const tailName = match[6] as string | undefined
  const base = {
    name: match[2],
    values: (match[3] as string | undefined)?.split('|'),
    typeName: match[4] as string | undefined,
    prefix: match[1],
  }
  if (tailName !== undefined) {
    return {
      ...base,
      suffix: '',
      optional: false,
      tail: {
        delimiter: match[5],
        name: tailName,
        values: (match[7] as string | undefined)?.split('|'),
        typeName: match[8] as string | undefined,
        optional: optionalMark,
      },
    }
  }
  return { ...base, suffix: (match[9] as string | undefined) ?? '', optional: optionalMark, tail: undefined }
}

/**
 * The wildcard-segment grammar, structured: `*` · `*?` · `prefix*` · `prefix*?` — and, new with tails, a literal suffix
 * or a tail param after the star: `*.md` · `docs-*.png` · `*.:ext` · `*.:ext(md|txt)?`. A wildcard with a tail or
 * suffix demands a NON-EMPTY body; `*?` cannot carry one, and `?` after a literal suffix is meaningless — only the tail
 * param may be optional.
 */
type ParsedWildcardSegment = {
  prefix: string
  optional: boolean
  suffix: string
  tail: ParsedParamTail | undefined
  /** Set when the part after the star parses as none of the valid forms — the caller reports it. */
  malformed: boolean
}

const WILDCARD_TAIL_REGEX =
  /^([.~-]):([A-Za-z0-9_]+)(?:\(([A-Za-z0-9_.~-]+(?:\|[A-Za-z0-9_.~-]+)*)\)|\[(-?[a-z]+)\])?(\?)?$/

/** Parses one path segment as a wildcard. Returns `undefined` when the segment carries no `*` at all. */
const parseWildcardSegment = (segment: string): ParsedWildcardSegment | undefined => {
  const starIndex = segment.indexOf('*')
  if (starIndex === -1) return undefined
  const prefix = segment.slice(0, starIndex)
  const after = segment.slice(starIndex + 1)
  const base = { prefix, optional: false, suffix: '', tail: undefined, malformed: false }
  if (after === '') return base
  if (after === '?') return { ...base, optional: true }
  const tailMatch = after.match(WILDCARD_TAIL_REGEX)
  if (tailMatch) {
    return {
      ...base,
      tail: {
        delimiter: tailMatch[1],
        name: tailMatch[2],
        values: (tailMatch[3] as string | undefined)?.split('|'),
        typeName: tailMatch[4] as string | undefined,
        optional: tailMatch[5] === '?',
      },
    }
  }
  if (/^[A-Za-z0-9_.~-]+$/.test(after)) return { ...base, suffix: after }
  return { ...base, malformed: true }
}

/**
 * Regex body matching exactly the values a param accepts. Always non-capturing — see `captureKeys`. A plain TAIL param
 * additionally excludes its delimiter (`excludeChar`) — in the raw AND the percent-encoded spelling (`%2E` for `.`), or
 * a hand-crafted URL could smuggle a delimiter into the tail and parse to a value that `get()` rightly refuses to
 * build. Both exclusions together pin the body/tail split to the last delimiter, bijectively. (Enum and typed tails
 * need no encoded-form guard: their closed charsets never admit `%`.)
 */
const paramRegexBody = (
  values: readonly string[] | undefined,
  type: ParamTypeName | undefined,
  excludeChar?: string,
): string => {
  if (values !== undefined) return `(?:${values.map(escapeRegex).join('|')})`
  if (type !== undefined) return `(?:${PARAM_TYPES[type].regexBody})`
  if (excludeChar === undefined) return '[^/]+'
  const hex = excludeChar.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  const encodedSpelling = `%${hex[0]}[${hex[1]}${hex[1].toLowerCase()}]`
  return `(?:(?!${encodedSpelling})[^/${escapeRegex(excludeChar)}])+`
}

/**
 * Strongly typed route descriptor and URL builder.
 *
 * A route definition uses:
 *
 * - path params: `/users/:id` · optional `:id?` · enum `:kind(new|top)` · typed `:id[int]` (see {@link ParamTypeName})
 * - a literal prefix/suffix around a param: `/img-:id[int].png`
 * - a wildcard tail: `/files/*`
 * - search declarations: `/users&q&page[int]=0&sort(new|top)&ids[int][]&token!`
 * - loose search mode: trailing `&`, e.g. `/users&page[int]&`
 *
 * Instances are callable (same as `.get()`), so `route(input)` and `route.get(input)` are equivalent.
 */
export class Route0<TDefinition extends string, TSearchInput extends UnknownSearchInput = UnknownSearchInput> {
  /** The normalized pattern this route was created from — the single source everything else derives from. */
  readonly definition: TDefinition
  /** Every path param as a descriptor, keyed by name (a wildcard under `'*'`, tail params included). */
  readonly params: _ParamsDefinition<TDefinition>
  private _origin: string | undefined
  private _callable: CallableRoute<TDefinition, TSearchInput>
  private _routeSegments?: string[]
  private _routeTokens?: readonly RouteToken[]
  private _paramsDefinition?: Record<string, ParamDefinition>
  private _searchParams?: Record<string, SearchParamDefinition>
  private _routeRegexBaseStringRaw?: string
  private _regexBaseString?: string
  private _regexString?: string
  private _regex?: RegExp
  private _regexAncestor?: RegExp
  private _regexDescendantMatchers?: Array<{ regex: RegExp; captureKeys: string[] }>
  private _captureKeys?: string[]

  static normalizeSlash = (value: string): string => {
    const collapsed = collapseDuplicateSlashes(value)
    if (collapsed === '' || collapsed === '/') return '/'
    const withLeadingSlash = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
    return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash
  }

  /** Slash-normalizes the path part of a definition; the search declarations (from the first `&`) stay verbatim. */
  static normalizeDefinition = (definition: string): string => {
    const amp = definition.indexOf('&')
    if (amp === -1) return Route0.normalizeSlash(definition)
    return Route0.normalizeSlash(definition.slice(0, amp)) + definition.slice(amp)
  }

  /** Path segments of a definition — the search declarations (everything from the first `&`) never count. */
  private static _getRouteSegments(definition: string): string[] {
    const { path } = splitDefinition(definition)
    if (path === '' || path === '/') return []
    return path.split('/').filter(Boolean)
  }

  /** Splits a definition into specificity-ranking parts (`/` stays a single part; search declarations don't rank). */
  private static _specificityParts(definition: string): string[] {
    const { path } = splitDefinition(definition)
    if (path === '' || path === '/') return ['/']
    return path.split('/').filter(Boolean)
  }

  /**
   * Rank of a segment the shorter route does not have at all.
   *
   * Sits above everything that can match nothing (wildcard, optional param) _and_ above a plain required param, but
   * below a constrained param and a static segment.
   *
   * The line falls there because a longer route earns a URL from its own prefix only when its extra segment names a
   * _finite, known_ set of values: `/:locale?/author` takes `/author` from `/:locale?`, and `/:l?/:kind(new|top)` takes
   * `/new`, because every value they do not name still belongs to the prefix. A generic `:param` tail names nothing, so
   * ranking it above absence would let `/x/:p?/:q` swallow `/x/v` from `/x/:p?`.
   *
   * Note the two languages there are _not_ disjoint: skipping the shared optional segment realigns the demanded one to
   * the left, so both routes match `/x/v`. That is why absence cannot simply be read as "exactly i segments".
   */
  private static readonly _RANK_ABSENT = 6

  /** Upper bound on constraint alternatives, kept below the TypeScript instantiation ceiling (see the throw site). */
  private static readonly _MAX_CONSTRAINT_VALUES = 32

  /**
   * Ranks a single path part by specificity, narrowest first:
   *
   * static (8) > enum required param (7) > _absent_ (6) > typed required param (5) > required param (4) > enum optional
   * param (3) > typed optional param (2) > optional param (1) > wildcard (0).
   *
   * Among real segments optionality stays dominant and constrainedness only breaks ties within a tier. A typed param
   * sits between an enum and a plain param: it names an infinite (so not enum-grade) but proper (so not plain-grade)
   * subset of the segment space. Absence (see `_RANK_ABSENT`) splits the required tier: an enum still earns a URL from
   * a shorter route's prefix, a typed param — like a plain one — does not (it names no _finite_ set).
   */
  /** The effective type of a raw definition part, `[str]` (the explicit default) normalized away. */
  private static _partTypeName(part: string): ParamTypeName | undefined {
    const typeName = parseParamSegment(part)?.typeName
    return typeName && typeName !== 'str' ? (typeName as ParamTypeName) : undefined
  }

  private static _partRank(part: string): number {
    if (part.includes('*')) return 0
    const param = parseParamSegment(part)
    if (param) {
      const typed = Route0._partTypeName(part) !== undefined
      if (param.optional) return param.values ? 3 : typed ? 2 : 1
      return param.values ? 7 : typed ? 5 : 4
    }
    return 8
  }

  /**
   * Fixed linearization of type languages, narrowest-leaning first, consistent with the subset lattice (a language
   * never precedes its own subset). A _total_ per-segment order matters more than the exact placement of incomparable
   * languages: breaking typed-tier ties by pairwise subset checks alone would let `Array.sort` see an intransitive
   * comparator (subset-decided here, string-decided there) and mis-order overlapping routes.
   */
  private static readonly _LANG_ORDER: readonly _ParamTypeLang[] = [
    'bool',
    'uuid',
    'date',
    'datetime',
    'nat',
    'zint',
    'dec',
    'zdec',
  ]

  /**
   * The literal text a param or wildcard part pins down: prefix + suffix + the tail's delimiter. More literal text ⇒ a
   * properly narrower matcher. `undefined` for a static (or unparsable) part.
   */
  private static _partLiteralLength(part: string): number | undefined {
    if (part.includes('*')) {
      const wildcard = parseWildcardSegment(part)
      if (!wildcard) return undefined
      return wildcard.prefix.length + wildcard.suffix.length + (wildcard.tail ? wildcard.tail.delimiter.length : 0)
    }
    const param = parseParamSegment(part)
    if (!param) return undefined
    return (param.prefix + param.suffix).length + (param.tail ? param.tail.delimiter.length : 0)
  }

  /** The tail (param- or wildcard-borne) of a raw definition part, if any. */
  private static _partTail(part: string): ParsedParamTail | undefined {
    if (part.includes('*')) return parseWildcardSegment(part)?.tail
    return parseParamSegment(part)?.tail
  }

  /** A tail's narrowness tier: enum (0, finite) < typed (1) < plain (2) < no tail at all (3). */
  private static _tailRank(tail: ParsedParamTail | undefined): number {
    if (tail === undefined) return 3
    if (tail.values) return 0
    if (tail.typeName && tail.typeName !== 'str') return 1
    return 2
  }

  /**
   * Same-rank tie-break for two param (or wildcard) parts, in fixed lexicographic order: more literal text first (an
   * affixed/tailed part is the properly narrower matcher, and between two of them more pinned-down text is narrower),
   * then a narrower first-type language, then the tail — narrower kind first (enum < typed < plain), then its language.
   * So `/x/:f.:e(md|txt)` is tried before `/x/:a.:b`, and `/x/9.5` still reaches a `[num]` tail before a plain one.
   * Lexicographic on fixed numeric keys keeps the comparator transitive — pairwise subset checks alone would not be.
   */
  private static _paramPartCompare(aPart: string, bPart: string): number {
    // valid segments are guaranteed: specificity only ever compares definitions of successfully created routes
    const aLiteral = Route0._partLiteralLength(aPart)
    const bLiteral = Route0._partLiteralLength(bPart)
    if (aLiteral === undefined || bLiteral === undefined) return 0
    if (aLiteral !== bLiteral) return bLiteral - aLiteral
    const aType = Route0._partTypeName(aPart)
    const bType = Route0._partTypeName(bPart)
    if (aType && bType) {
      const aIndex = Route0._LANG_ORDER.indexOf(PARAM_TYPES[aType].lang)
      const bIndex = Route0._LANG_ORDER.indexOf(PARAM_TYPES[bType].lang)
      if (aIndex !== bIndex) return aIndex - bIndex
    }
    const aTail = Route0._partTail(aPart)
    const bTail = Route0._partTail(bPart)
    const aTailRank = Route0._tailRank(aTail)
    const bTailRank = Route0._tailRank(bTail)
    if (aTailRank !== bTailRank) return aTailRank - bTailRank
    const aTailType = aTail?.typeName && aTail.typeName !== 'str' ? (aTail.typeName as ParamTypeName) : undefined
    const bTailType = bTail?.typeName && bTail.typeName !== 'str' ? (bTail.typeName as ParamTypeName) : undefined
    if (aTailType && bTailType) {
      return (
        Route0._LANG_ORDER.indexOf(PARAM_TYPES[aTailType].lang) -
        Route0._LANG_ORDER.indexOf(PARAM_TYPES[bTailType].lang)
      )
    }
    return 0
  }

  /**
   * Total, transitive specificity order. Negative ⇒ `a` is more specific (sorts first).
   *
   * Compares segment ranks left-to-right (see `_partRank`), breaking typed-tier ties by language narrowness (so
   * `/:a[int]` is tried before `/:b[num]`, and `/x/3` reaches the int route while `/x/1.5` still reaches the num one).
   * A shorter route that is a prefix of a longer one loses only where the longer route's extra segment names a finite
   * set of values — a static segment or an enum param. So `/:locale?/author` beats `/:locale?`, while `/users` still
   * beats both `/users/:id?` and `/users/:id`. Fully equal structures fall back to the definition string so the order
   * is deterministic regardless of insertion order — critical because the matcher relies on it to pick the right page.
   */
  private static _compareSpecificity(aDefinition: string, bDefinition: string): number {
    const aParts = Route0._specificityParts(aDefinition)
    const bParts = Route0._specificityParts(bDefinition)
    const length = Math.max(aParts.length, bParts.length)
    for (let i = 0; i < length; i++) {
      // a missing segment outranks anything that may match nothing and any generic or typed param, and loses only
      // to a segment naming a finite value set (static, enum param)
      const aRank = i < aParts.length ? Route0._partRank(aParts[i]) : Route0._RANK_ABSENT
      const bRank = i < bParts.length ? Route0._partRank(bParts[i]) : Route0._RANK_ABSENT
      if (aRank !== bRank) return bRank - aRank
      if (i < aParts.length && i < bParts.length) {
        const paramCompare = Route0._paramPartCompare(aParts[i], bParts[i])
        if (paramCompare !== 0) return paramCompare
      }
    }
    return aDefinition < bDefinition ? -1 : aDefinition > bDefinition ? 1 : 0
  }

  /**
   * True when a token can match the empty segment sequence, i.e. the route is still satisfiable without it.
   *
   * Mirrors `routeRegexBaseStringRaw`, which is the authority: a bare wildcard compiles to `(?:/(.*))?` and is
   * skippable whether or not it is written `*?`, while a prefixed one compiles to `/prefix(.*)` and always demands at
   * least `/prefix`.
   */
  private static _tokenCanMatchNothing(token: RouteToken): boolean {
    if (token.kind === 'param') return token.optional
    // a bare wildcard is skippable; a prefixed one, or one with a suffix/tail, always demands a segment
    if (token.kind === 'wildcard') return token.prefix.length === 0 && !token.suffix && !token.tail
    return false
  }

  private static _tailCanMatchNothing(tokens: readonly RouteToken[], from: number): boolean {
    for (let i = from; i < tokens.length; i++) {
      if (!Route0._tokenCanMatchNothing(tokens[i])) return false
    }
    return true
  }

  /**
   * The full segment strings a matcher accepts, when finite: a static value, or an enum's values wrapped in the param's
   * prefix/suffix. `undefined` for the infinite matchers (typed and plain params).
   */
  private static _segmentFiniteStrings(token: _SegmentToken): string[] | undefined {
    if (token.kind === 'static') return [token.value]
    // a tail param makes the segment's string set effectively infinite (no value-set product is enumerated)
    if (token.values === undefined || token.tail !== undefined) return undefined
    const prefix = token.prefix ?? ''
    const suffix = token.suffix ?? ''
    return token.values.map((value) => `${prefix}${value}${suffix}`)
  }

  /** True when an infinite segment matcher (typed/plain param, possibly tailed) accepts the segment string `value`. */
  private static _paramAcceptsString(token: Extract<RouteToken, { kind: 'param' }>, value: string): boolean {
    const prefix = token.prefix ?? ''
    const suffix = token.suffix ?? ''
    if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false
    const middle = value.slice(prefix.length, value.length - suffix.length)
    if (middle.length === 0) return false
    // a tailed segment stays conservative (any non-empty middle counts) — precision lives in the regexes, not here
    if (token.tail !== undefined) return true
    return token.type === undefined ? true : _typeMatches(token.type, middle)
  }

  /**
   * True when two segment matchers accept a common segment.
   *
   * Finite sides (static values, enums — their prefix/suffix folded in) compare exactly: set intersection, or a
   * membership test against the other side's matcher. Two infinite sides compare by structure: prefixes and suffixes
   * must nest (which is what lets `/a-:x` and `/b-:y` coexist), and two bare typed params meet exactly when their
   * languages do (see `_langRelation` — `/:a[int]` and `/:b[uuid]` coexist conflict-free). An affixed pair whose
   * affixes nest is reported as intersecting without consulting the body languages — the conservative direction.
   */
  private static _segmentsIntersect(a: _SegmentToken, b: _SegmentToken): boolean {
    const aStrings = Route0._segmentFiniteStrings(a)
    const bStrings = Route0._segmentFiniteStrings(b)
    if (aStrings !== undefined && bStrings !== undefined) {
      return aStrings.some((value) => bStrings.includes(value))
    }
    if (aStrings !== undefined) {
      return aStrings.some((value) => Route0._paramAcceptsString(b as Extract<RouteToken, { kind: 'param' }>, value))
    }
    if (bStrings !== undefined) {
      return bStrings.some((value) => Route0._paramAcceptsString(a as Extract<RouteToken, { kind: 'param' }>, value))
    }
    const aParam = a as Extract<RouteToken, { kind: 'param' }>
    const bParam = b as Extract<RouteToken, { kind: 'param' }>
    const aPrefix = aParam.prefix ?? ''
    const bPrefix = bParam.prefix ?? ''
    const aSuffix = aParam.suffix ?? ''
    const bSuffix = bParam.suffix ?? ''
    if (!aPrefix.startsWith(bPrefix) && !bPrefix.startsWith(aPrefix)) return false
    if (!aSuffix.endsWith(bSuffix) && !bSuffix.endsWith(aSuffix)) return false
    if (aPrefix === bPrefix && aSuffix === bSuffix) {
      // With EQUAL affixes the bodies align exactly (P+x+S = P+y+S ⟺ x = y), so the constraints decide — this is
      // what lets `/img-:a[int].png` and `/img-:d[date].png` coexist. And with equal delimiters on top, both tailed
      // patterns split any candidate at the same LAST delimiter, so the languages intersect exactly when both the
      // first parts and the tails do. Nested-but-different affixes shift the alignment, and only there (or across
      // differing delimiters / a tailed-vs-untailed pair) does the conservative `true` stand in.
      if (aParam.tail !== undefined && bParam.tail !== undefined && aParam.tail.delimiter === bParam.tail.delimiter) {
        return (
          _constraintsIntersect(aParam.values, aParam.type, bParam.values, bParam.type) &&
          _constraintsIntersect(aParam.tail.values, aParam.tail.type, bParam.tail.values, bParam.tail.type)
        )
      }
      if (aParam.tail === undefined && bParam.tail === undefined) {
        return _constraintsIntersect(aParam.values, aParam.type, bParam.values, bParam.type)
      }
    }
    return true
  }

  /** True when a segment matcher accepts some segment starting with `prefix` (the head a prefixed wildcard demands). */
  private static _acceptsSegmentStartingWith(token: _SegmentToken, prefix: string): boolean {
    const finite = Route0._segmentFiniteStrings(token)
    if (finite !== undefined) return finite.some((value) => value.startsWith(prefix))
    // An infinite param accepts some such segment when its own literal prefix nests with the demanded one — the value
    // itself is unconstrained enough (typed bodies are deliberately not consulted: deciding "does some member of the
    // language start with the remainder" needs a prefix automaton, and over-reporting overlap is the safe direction).
    const ownPrefix = (token as Extract<RouteToken, { kind: 'param' }>).prefix ?? ''
    return ownPrefix.startsWith(prefix) || prefix.startsWith(ownPrefix)
  }

  /** True when `tokens` from `from` can produce a non-empty tail whose first segment starts with `prefix`. */
  private static _tailCanStartWith(tokens: readonly RouteToken[], from: number, prefix: string): boolean {
    for (let i = from; i < tokens.length; i++) {
      const token = tokens[i]
      // a wildcard owns the whole tail: bare accepts anything, prefixed needs the two prefixes to nest
      if (token.kind === 'wildcard') {
        return token.prefix.length === 0 || token.prefix.startsWith(prefix) || prefix.startsWith(token.prefix)
      }
      if (Route0._acceptsSegmentStartingWith(token, prefix)) return true
      if (!Route0._tokenCanMatchNothing(token)) return false
    }
    // everything left is skippable, so the only tail on offer is empty — and `prefix` is non-empty
    return false
  }

  /**
   * True when two token sequences accept a common pathname — exactly, with no enumeration.
   *
   * Walks both sides in lockstep over `(i, j)` positions, memoized, so optional params (which shift the alignment) stay
   * polynomial instead of exponential. Wildcards are always the last token — the definition validator guarantees it —
   * so a wildcard simply owns the whole remaining tail rather than needing its own alignment.
   *
   * Enumerating concrete candidate paths instead would be both slower and wrong: any bound on the candidate space is a
   * false negative waiting to happen once params carry real value sets.
   */
  private static _tokensOverlap(a: readonly RouteToken[], b: readonly RouteToken[]): boolean {
    const memo = new Map<number, boolean>()
    const stride = b.length + 1
    // every recursive step advances i + j, so the memo never has to guard an in-progress state
    const walk = (i: number, j: number): boolean => {
      const key = i * stride + j
      const cached = memo.get(key)
      if (cached !== undefined) return cached
      const result = step(i, j)
      memo.set(key, result)
      return result
    }
    const step = (i: number, j: number): boolean => {
      const aToken = i < a.length ? a[i] : undefined
      const bToken = j < b.length ? b[j] : undefined
      if (aToken === undefined && bToken === undefined) return true
      if (aToken === undefined) return Route0._tailCanMatchNothing(b, j)
      if (bToken === undefined) return Route0._tailCanMatchNothing(a, i)
      // Wildcards are handled one side at a time so each branch narrows its own token — a combined
      // `a is wildcard || b is wildcard` guard tells the compiler nothing about which of the two it was.
      if (aToken.kind === 'wildcard' && bToken.kind === 'wildcard') {
        // the prefixes must nest (a bare wildcard has prefix '', which every prefix starts with) — and so must the
        // segment ends: two literal suffixes have to nest, and two same-delimiter tails need intersecting languages
        // (`/docs/*.md` and `/docs/*.js` can never share a URL). A suffix-vs-tail pair, differing delimiters, or an
        // unconstrained side stay conservatively compatible.
        if (!aToken.prefix.startsWith(bToken.prefix) && !bToken.prefix.startsWith(aToken.prefix)) return false
        if (aToken.suffix !== undefined && bToken.suffix !== undefined) {
          return aToken.suffix.endsWith(bToken.suffix) || bToken.suffix.endsWith(aToken.suffix)
        }
        if (aToken.tail !== undefined && bToken.tail !== undefined && aToken.tail.delimiter === bToken.tail.delimiter) {
          return _constraintsIntersect(aToken.tail.values, aToken.tail.type, bToken.tail.values, bToken.tail.type)
        }
        return true
      }
      // a bare wildcard matches every tail, and the other side's remaining tokens are always satisfiable;
      // a prefixed one needs the other side to open with a segment carrying that prefix
      if (aToken.kind === 'wildcard') {
        return aToken.prefix.length === 0 || Route0._tailCanStartWith(b, j, aToken.prefix)
      }
      if (bToken.kind === 'wildcard') {
        return bToken.prefix.length === 0 || Route0._tailCanStartWith(a, i, bToken.prefix)
      }
      // an optional param may be left out, which realigns the rest against the other side
      if (aToken.kind === 'param' && aToken.optional && walk(i + 1, j)) return true
      if (bToken.kind === 'param' && bToken.optional && walk(i, j + 1)) return true
      return Route0._segmentsIntersect(aToken, bToken) && walk(i + 1, j + 1)
    }
    return walk(0, 0)
  }

  private static _validateSearchDeclarations(definition: string): void {
    const { decls, hasSearch } = splitDefinition(definition)
    if (hasSearch) {
      // only the very last chunk may be empty (the loose trailing `&`) — `&&` anywhere is a typo, and rejecting it
      // keeps the runtime definition byte-identical to what the type level reconstructs in `PathExtended`
      const chunks = definition.slice(definition.indexOf('&') + 1).split('&')
      if (chunks.some((chunk, index) => chunk === '' && index !== chunks.length - 1)) {
        throw new Error(`Invalid route definition "${definition}": empty search declaration (stray "&")`)
      }
    }
    const seenNames = new Set<string>()
    for (const decl of decls) {
      const parsed = parseSearchDecl(decl)
      if (!parsed) {
        throw new Error(
          `Invalid route definition "${definition}": malformed search declaration "&${decl}". Expected "&name" ` +
            `optionally followed by "[type]" or "(a|b)", then "[]" (array), then "!" (required), then "=default" — ` +
            `the name is [A-Za-z0-9_]+ and the default is [A-Za-z0-9_.~-]+.`,
        )
      }
      if (parsed.typeName && parsed.typeName !== 'str' && !(parsed.typeName in PARAM_TYPES)) {
        throw new Error(
          `Invalid route definition "${definition}": unknown search param type "[${parsed.typeName}]" in "&${decl}". ` +
            `Valid types: [str], ${PARAM_TYPE_NAMES.map((name) => `[${name}]`).join(', ')}.`,
        )
      }
      if (parsed.required && parsed.defaultRaw !== undefined) {
        throw new Error(
          `Invalid route definition "${definition}": "&${decl}" combines "!" with a default — a required param can ` +
            `never be absent, so there is nothing for the default to fill.`,
        )
      }
      if (parsed.array && parsed.defaultRaw !== undefined) {
        throw new Error(
          `Invalid route definition "${definition}": "&${decl}" combines "[]" with a default — an absent array ` +
            `already parses to [].`,
        )
      }
      if (parsed.values) {
        if (parsed.values.length > Route0._MAX_CONSTRAINT_VALUES) {
          throw new Error(
            `Invalid route definition "${definition}": "&${decl}" has ${parsed.values.length} allowed values, ` +
              `the maximum is ${Route0._MAX_CONSTRAINT_VALUES}`,
          )
        }
        const seenValues = new Set<string>()
        for (const value of parsed.values) {
          if (seenValues.has(value)) {
            throw new Error(
              `Invalid route definition "${definition}": duplicate constraint value "${value}" in "&${decl}"`,
            )
          }
          seenValues.add(value)
        }
      }
      if (parsed.defaultRaw !== undefined) {
        if (parsed.values && !parsed.values.includes(parsed.defaultRaw)) {
          throw new Error(
            `Invalid route definition "${definition}": default "${parsed.defaultRaw}" in "&${decl}" is not one of ` +
              `the allowed values`,
          )
        }
        const typeName = parsed.typeName && parsed.typeName !== 'str' ? (parsed.typeName as ParamTypeName) : undefined
        if (typeName && !_typeMatches(typeName, parsed.defaultRaw)) {
          throw new Error(
            `Invalid route definition "${definition}": default "${parsed.defaultRaw}" in "&${decl}" is not a ` +
              `canonical [${typeName}] value`,
          )
        }
      }
      if (seenNames.has(parsed.name)) {
        throw new Error(`Invalid route definition "${definition}": duplicate search param name "${parsed.name}"`)
      }
      seenNames.add(parsed.name)
    }
  }

  /** Shared enum/type validity checks for a param position (first, tail, or wildcard tail). */
  private static _validateConstraint(
    definition: string,
    segment: string,
    values: string[] | undefined,
    typeName: string | undefined,
  ): void {
    if (typeName && typeName !== 'str' && !(typeName in PARAM_TYPES)) {
      throw new Error(
        `Invalid route definition "${definition}": unknown param type "[${typeName}]" in "${segment}". ` +
          `Valid types: [str], ${PARAM_TYPE_NAMES.map((name) => `[${name}]`).join(', ')}.`,
      )
    }
    if (values) {
      // Measured on TS 6.0.3 and 7.0.2: 46 alternatives still check, 48 blow the instantiation budget with a
      // cryptic TS2589 at the call site. Cap well below that so the author gets this message instead.
      if (values.length > Route0._MAX_CONSTRAINT_VALUES) {
        throw new Error(
          `Invalid route definition "${definition}": "${segment}" has ${values.length} allowed values, ` +
            `the maximum is ${Route0._MAX_CONSTRAINT_VALUES}`,
        )
      }
      const seenValues = new Set<string>()
      for (const value of values) {
        if (seenValues.has(value)) {
          throw new Error(
            `Invalid route definition "${definition}": duplicate constraint value "${value}" in "${segment}"`,
          )
        }
        seenValues.add(value)
      }
    }
  }

  /**
   * The tail-side rules: the tail's language must never contain its own delimiter — that is what pins the body/tail
   * split to the last delimiter and keeps it deterministic.
   */
  private static _validateTail(definition: string, segment: string, tail: ParsedParamTail): void {
    Route0._validateConstraint(definition, segment, tail.values, tail.typeName)
    if (tail.values?.some((value) => value.includes(tail.delimiter))) {
      throw new Error(
        `Invalid route definition "${definition}": a tail value in "${segment}" contains the delimiter ` +
          `"${tail.delimiter}" — the tail could then swallow its own split point`,
      )
    }
    const typeName = tail.typeName && tail.typeName !== 'str' ? (tail.typeName as ParamTypeName) : undefined
    if (typeName && PARAM_TYPE_DELIMITER_CHARS[typeName].includes(tail.delimiter)) {
      throw new Error(
        `Invalid route definition "${definition}": tail type [${typeName}] in "${segment}" can contain the ` +
          `delimiter "${tail.delimiter}" — the split would be ambiguous. Pick another delimiter or type.`,
      )
    }
  }

  private static _validateRouteDefinition(definition: string): void {
    const segments = Route0._getRouteSegments(definition)

    // Param grammar. Runs before the wildcard checks so a malformed param reports the specific reason.
    // Without this, anything unparseable silently degrades into a literal static segment that matches nothing.
    const seenParamNames = new Set<string>()
    const addParamName = (name: string): void => {
      if (seenParamNames.has(name)) {
        throw new Error(`Invalid route definition "${definition}": duplicate param name "${name}"`)
      }
      seenParamNames.add(name)
    }
    for (const segment of segments) {
      // A `*` segment is a wildcard (`:prefix*` included), and a segment without `:` is static — everything else
      // declares param intent and must parse.
      if (!segment.includes(':') || segment.includes('*')) continue
      const param = parseParamSegment(segment)
      if (!param) {
        // An unbalanced "(" is worth calling out: the quoted segment is then only the head of what the author wrote,
        // because a "/" inside a constraint splits it before this check ever sees it.
        const unbalanced = segment.includes('(') && !segment.includes(')')
        throw new Error(
          `Invalid route definition "${definition}": malformed param segment "${segment}". Expected ":name", ` +
            `":name(a|b)" or ":name[int]", optionally wrapped in a literal prefix/suffix ("img-:id[int].png") or ` +
            `followed by a one-character delimiter (".", "~", "-") and a tail param (":slug.:ext"), and optionally ` +
            `ending in "?" — at most two params per segment, a name is [A-Za-z0-9_]+, and the prefix, suffix and ` +
            `each allowed value are [A-Za-z0-9_.~-]+.` +
            (unbalanced
              ? ' The "(" is never closed: either the ")" is missing, or the constraint contained a "/", which' +
                ' splits the segment before it reaches this check.'
              : ''),
        )
      }
      Route0._validateConstraint(definition, segment, param.values, param.typeName)
      addParamName(param.name)
      if (param.tail) {
        Route0._validateTail(definition, segment, param.tail)
        addParamName(param.tail.name)
        if (param.tail.optional) {
          // With the tail omitted the first value must not fake a tail — for enum/typed first params whose language
          // can contain the delimiter that cannot be ruled out (and their fixed-form regexes cannot go lazy), so the
          // combination is rejected. A plain first param stays legal: its body simply matches lazily.
          const delimiter = param.tail.delimiter
          const firstType = param.typeName && param.typeName !== 'str' ? (param.typeName as ParamTypeName) : undefined
          const firstMayContainDelimiter = param.values
            ? param.values.some((value) => value.includes(delimiter))
            : firstType
              ? PARAM_TYPE_DELIMITER_CHARS[firstType].includes(delimiter)
              : false
          if (firstMayContainDelimiter) {
            throw new Error(
              `Invalid route definition "${definition}": in "${segment}" the first param's values can contain the ` +
                `delimiter "${param.tail.delimiter}" while the tail is optional — a URL without the tail would be ` +
                `ambiguous. Make the tail required or pick another delimiter.`,
            )
          }
        }
      }
    }

    Route0._validateSearchDeclarations(definition)

    const wildcardSegments = segments.filter((segment) => segment.includes('*'))
    if (wildcardSegments.length === 0) return
    if (wildcardSegments.length > 1) {
      throw new Error(`Invalid route definition "${definition}": only one wildcard segment is allowed`)
    }
    const wildcardSegmentIndex = segments.findIndex((segment) => segment.includes('*'))
    const wildcardSegment = segments[wildcardSegmentIndex]
    if (wildcardSegmentIndex !== segments.length - 1) {
      throw new Error(`Invalid route definition "${definition}": wildcard segment is allowed only at the end`)
    }
    const wildcard = parseWildcardSegment(wildcardSegment)
    if (!wildcard) return // unreachable — the segment contains a star
    // The legacy `:prefix*` spelling keeps its leading `:`, but a `:` anywhere else before the star is a param trying
    // to share the segment — reject it, or `/a-:id*` would silently become a wildcard with the literal prefix
    // `a-:id` (the "never silently downgraded" rule of the param grammar, applied to wildcards).
    if (wildcard.prefix.slice(1).includes(':')) {
      throw new Error(`Invalid route definition "${definition}": a param cannot share a segment with a wildcard`)
    }
    if (wildcard.prefix.includes('(') || wildcard.malformed) {
      const afterStar = wildcardSegment.slice(wildcardSegment.indexOf('*') + 1)
      if (wildcard.prefix.includes('(') || afterStar.includes('(')) {
        throw new Error(`Invalid route definition "${definition}": a wildcard cannot carry a value constraint`)
      }
      if (afterStar.includes('[')) {
        throw new Error(`Invalid route definition "${definition}": a wildcard cannot carry a type`)
      }
      throw new Error(
        `Invalid route definition "${definition}": malformed wildcard segment "${wildcardSegment}". Expected "*", ` +
          `"*?", "prefix*", a literal suffix ("*.md") or a tail param ("*.:ext", "*.:ext(md|txt)?") — "*?" cannot ` +
          `carry a suffix or tail, and "?" may only follow a tail param.`,
      )
    }
    if (wildcard.tail) {
      Route0._validateTail(definition, wildcardSegment, wildcard.tail)
      addParamName(wildcard.tail.name)
    }
  }

  /**
   * Type-only access to everything inferable from this route — read it through `typeof route.Infer.X`. Its runtime
   * value is `null`; each member also exists as a standalone exported type (`ParamsOutput<typeof route>`, ...).
   */
  Infer: {
    ParamsDefinition: _ParamsDefinition<TDefinition>
    ParamsInput: _ParamsInput<TDefinition>
    ParamsInputStringOnly: _ParamsInputStringOnly<TDefinition>
    ParamsOutput: ParamsOutput<TDefinition>
    /** Everything `get()`'s `?` accepts: declared search params + the `.search<T>()` addition (+ extras when loose). */
    SearchInput: _SearchInputCombined<TDefinition, TSearchInput>
    /** Same as `SearchInput`, but every declared param in its URL-string form — see `ParamsInputStringOnly`. */
    SearchInputStringOnly: _SearchInputStringOnly<TDefinition>
    /** What `searchSchema` yields — declared keys coerced, defaults filled, arrays always arrays. */
    SearchOutput: _SearchOutput<TDefinition>
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
    const normalizedDefinition = Route0.normalizeDefinition(definition) as TDefinition
    Route0._validateRouteDefinition(normalizedDefinition)
    this.definition = normalizedDefinition
    this.params = this.paramsDefinition as _ParamsDefinition<TDefinition>

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
      Route0.normalizeDefinition(definition) as NormalizeRouteDefinition<TDefinition>,
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
            Route0.normalizeDefinition(definition) as NormalizeRouteDefinition<TDefinition>,
          )
    return original._callable as CallableRoute<NormalizeRouteDefinition<TDefinition>, TSearchInput>
  }

  private static _getAbsPath(origin: string, url: string, encode = true) {
    // unencoded: keep the path raw (URL's serializer would percent-encode it), just prefix the origin's scheme+host
    if (!encode) return `${new URL(origin).origin}${url}`.replace(/\/$/, '')
    return new URL(url, origin).toString().replace(/\/$/, '')
  }

  /**
   * Locks in an extra search-param shape — a type-only refinement (no runtime cost, returns the same instance) for what
   * the definition string cannot express: nested objects and arrays of objects. Merges ON TOP of the declared search
   * params; a key the definition already declares is rejected at the type level.
   */
  search<TNewSearchInput extends _SearchInputAddition<TDefinition>>(): CallableRoute<TDefinition, TNewSearchInput> {
    return this._callable as CallableRoute<TDefinition, TNewSearchInput>
  }

  /**
   * Every declared search param as a descriptor, keyed by name — the search-side sibling of `params`. Empty when the
   * definition declares none.
   */
  get searchParams(): Record<string, SearchParamDefinition> {
    if (this._searchParams === undefined) {
      const { decls } = splitDefinition(this.definition)
      const entries: Array<[string, SearchParamDefinition]> = []
      for (const decl of decls) {
        const parsed = parseSearchDecl(decl)
        if (!parsed) continue // unreachable — the constructor validated every declaration
        const typeName = parsed.typeName && parsed.typeName !== 'str' ? (parsed.typeName as ParamTypeName) : undefined
        const base = { required: parsed.required, array: parsed.array }
        const definition: SearchParamDefinition = parsed.values
          ? { ...base, type: 'enum', values: Object.freeze(parsed.values) }
          : typeName
            ? { ...base, type: typeName }
            : { ...base, type: 'string' }
        if (parsed.defaultRaw !== undefined) {
          // the raw default was validated at construction; typed params store the parsed (typed) value
          definition.default = typeName
            ? (PARAM_TYPES[typeName].parse(parsed.defaultRaw) as boolean | number | bigint | Date)
            : parsed.defaultRaw
        }
        entries.push([parsed.name, Object.freeze(definition)])
      }
      this._searchParams = Object.freeze(Object.fromEntries(entries))
    }
    return this._searchParams
  }

  /**
   * True when undeclared search keys are fair game: the definition declares no search at all, or ends with the loose
   * `&`. False (strict) once params are declared without the trailing `&` — then `get()`'s `?` object is closed and
   * `searchSchema` drops unknown keys.
   */
  get searchLoose(): boolean {
    const { loose, hasSearch } = splitDefinition(this.definition)
    return !hasSearch || loose
  }

  /**
   * Extends the current route definition by appending a suffix route (path and search declarations both).
   *
   * Known type-level edge: the extended route keeps `TSearchInput` from a `.search<T>()` call on the base, and its
   * no-collision constraint was checked against the base's declarations only — a suffix declaring a key that `T` also
   * carries isn't caught. The runtime duplicate-name check covers declaration-vs-declaration; declaration-vs-`T` on
   * this path is accepted as-is.
   *
   * Only a PLAIN trailing wildcard gives way to the suffix. A wildcard carrying a literal suffix or a tail
   * (`/docs/*.md`, `/raw/*.:ext`) is not stripped, so extending such a route throws the wildcard-placement error —
   * deliberate: silently dropping a constrained wildcard would change what the base route promised to match.
   */
  extend<TSuffixDefinition extends string>(
    suffixDefinition: TSuffixDefinition,
  ): CallableRoute<PathExtended<TDefinition, TSuffixDefinition>, TSearchInput> {
    const base = splitDefinition(this.definition)
    const suffix = splitDefinition(Route0.normalizeDefinition(suffixDefinition))
    // a trailing wildcard gives way to the suffix, as before
    const path = Route0.normalizeSlash(`${base.path.replace(/\*\??$/, '')}/${suffix.path}`)
    const decls = [...base.decls, ...suffix.decls]
    const loose = (base.hasSearch && base.loose) || (suffix.hasSearch && suffix.loose)
    const definition = `${path}${decls.map((decl) => `&${decl}`).join('')}${loose ? '&' : ''}`
    return Route0.create<PathExtended<TDefinition, TSuffixDefinition>>(
      definition as PathExtended<TDefinition, TSuffixDefinition>,
      {
        origin: this._origin,
      },
    ) as CallableRoute<PathExtended<TDefinition, TSuffixDefinition>, TSearchInput>
  }

  /**
   * Builds the route's URL from its params (path params at the top level, search under `'?'`, hash under `'#'`).
   * Calling the route itself is the same thing.
   *
   * NEVER throws, literally — building a link must not be the thing that takes a page down. The TS types are the strict
   * layer; at runtime a typed param also accepts its canonical string form (`'3'` for `[int]`), and anything invalid
   * that gets past the types is emitted best-effort — a broken href that at worst matches nothing. A missing or empty
   * required value becomes the literal `undefined` (never a collapsed segment, which could cross-match a sibling
   * route), a hostile value (throwing `toString`, a proxy for an input object) degrades the same way, and an unset or
   * malformed `origin` keeps the URL relative. Validate with `schema` when you want loud failures instead.
   */
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

  /**
   * The `?` object as it goes to the search stringifier: declared keys serialized best-effort (arrays element-wise, a
   * single value wrapped), `undefined` (and missing-required — see the never-throw policy on `get`) simply dropped,
   * undeclared keys passed through untouched. Defaults are parse-side only — building never inserts them.
   */
  private _serializeSearchForBuild(input: Record<string, unknown>): Record<string, unknown> {
    const defs = this.searchParams
    if (Object.keys(defs).length === 0) return input
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      const def = defs[key] as SearchParamDefinition | undefined
      if (!def) {
        output[key] = value
        continue
      }
      if (value === undefined) continue
      const constraint: { values?: readonly string[]; type?: ParamTypeName } =
        def.type === 'enum' ? { values: def.values } : def.type === 'string' ? {} : { type: def.type }
      if (def.array) {
        output[key] = (Array.isArray(value) ? value : [value]).map((element) =>
          Route0._serializeParamBestEffort(constraint, element),
        )
        continue
      }
      output[key] = Route0._serializeParamBestEffort(constraint, value)
    }
    return output
  }

  /**
   * One param value → the string that goes into the URL (before percent-encoding) — the never-throw serializer behind
   * `get()`. `part` is any param-shaped position: a path param, its tail, a wildcard tail, or a search param.
   *
   * A valid value serializes canonically, and the canonical STRING form of a typed value is accepted too (`'3'` for
   * `[int]` — everything on the wire is a string, so the runtime meets JS callers halfway; the TS types stay strict).
   * Anything else falls back to `String(value)` verbatim: the result is a link that (at worst) matches nothing —
   * building a URL must never be the thing that takes a page down. `schema` is the loud counterpart.
   */
  private static _serializeParamBestEffort(
    part: { values?: readonly string[]; type?: ParamTypeName },
    value: unknown,
  ): string {
    if (part.values) {
      const stringValue = typeof value === 'number' ? String(value) : value
      if (typeof stringValue === 'string' && part.values.includes(stringValue)) return stringValue
      return Route0._safeString(value)
    }
    if (part.type) {
      if (typeof value === 'string' && _typeMatches(part.type, value)) return value
      const result = _serializeParamValue(part.type, value)
      return 'value' in result ? result.value : Route0._safeString(value)
    }
    return Route0._safeString(value)
  }

  /**
   * The bijection guard for an OMITTED optional tail, used by the schema (never by `get()` — see its never-throw
   * policy): true when the emitted body text would re-parse as `body + delimiter + tail`, i.e. the URL built without
   * the tail would come back with one. The generic body pattern is a superset of every first-body language, so this can
   * only over-fire — and only where the ambiguity is real.
   */
  private static _tailReparses(tail: RouteTokenTail, bodyKind: 'segment' | 'wildcard', emittedBody: string): boolean {
    const bodyPattern = bodyKind === 'wildcard' ? '.+' : '[^/]+'
    const regex = new RegExp(
      `^(?:${bodyPattern})${escapeRegex(tail.delimiter)}(?:${paramRegexBody(tail.values, tail.type, tail.delimiter)})$`,
    )
    return regex.test(emittedBody)
  }

  /** `String()` that never throws — a hostile `toString()` yields `''` (the never-throw policy of `get`). */
  private static _safeString(value: unknown): string {
    try {
      return String(value)
    } catch {
      return ''
    }
  }

  /** `encodeURIComponent` that never throws — a lone surrogate comes back verbatim (the never-throw policy of `get`). */
  private static _safeEncode(value: string): string {
    try {
      return encodeURIComponent(value)
    } catch {
      return value
    }
  }

  private _build(args: unknown[], originByDefault: boolean): string {
    const input = typeof args[0] === 'object' && args[0] !== null ? (args[0] as Record<string, unknown>) : {}
    const options = typeof args[1] === 'object' && args[1] !== null ? (args[1] as RouteGetOptions) : {}

    const origin = options.origin ?? (originByDefault ? true : undefined)
    const encode = options.encode !== false
    const absOriginInput = typeof origin === 'string' && origin.length > 0 ? origin : undefined
    const absInput = absOriginInput !== undefined || origin === true
    const enc = encode ? Route0._safeEncode : (value: string): string => value

    let searchInput: Record<string, unknown> = {}
    let hashInput: string | undefined = undefined
    const paramsInput: Record<string, unknown> = {}
    // even reading the input is guarded — a throwing getter, ownKeys trap or revoked proxy degrades to "no input"
    let inputEntries: Array<[string, unknown]> = []
    try {
      inputEntries = Object.entries(input)
    } catch {
      inputEntries = []
    }
    for (const [key, value] of inputEntries) {
      if (key === '?' && typeof value === 'object' && value !== null) {
        searchInput = value as Record<string, unknown>
      } else if (key === '#' && (typeof value === 'string' || typeof value === 'number')) {
        hashInput = String(value)
      } else if (key in this.params && value !== undefined) {
        Object.assign(paramsInput, { [key]: value })
      }
    }

    // create url

    // Params are substituted token-wise off the parsed path rather than by regex surgery on the definition, so a
    // constraint can never leak into the produced URL. Everything is best-effort by policy: `get()` NEVER throws —
    // an invalid value (only reachable past the types) yields a link that at worst matches nothing, because a broken
    // href is a far smaller blast radius than a page that dies building one. `schema` is the loud counterpart. A
    // missing REQUIRED value emits the literal string `undefined`, keeping the failure visible and greppable.
    const outSegments: string[] = ['']
    // Emits `delimiter + tail value`, or `''` for an omitted optional tail. An empty serialization counts as
    // absent — emitting it would change what the segment parses back to.
    const tailText = (tail: RouteTokenTail): string => {
      const tailValue = paramsInput[tail.name]
      const serialized = tailValue === undefined ? '' : enc(Route0._serializeParamBestEffort(tail, tailValue))
      if (serialized === '') {
        return tail.optional ? '' : `${tail.delimiter}undefined`
      }
      return `${tail.delimiter}${serialized}`
    }
    for (const token of this.routeTokens) {
      if (token.kind === 'static') {
        outSegments.push(token.value)
        continue
      }
      if (token.kind === 'wildcard') {
        const rawValue = paramsInput['*']
        // The value is substituted right here, never via string surgery on the assembled URL — a `*` inside the
        // value (or inside any other param's value) must stay a literal, not become a placeholder.
        if (rawValue === undefined && token.optional && token.prefix === '' && !token.suffix && !token.tail) {
          continue // the bare `*?` drops out
        }
        // the wildcard value goes in raw (it may span segments); a missing value leaves just the prefix
        const stringValue = rawValue === undefined ? '' : Route0._safeString(rawValue)
        outSegments.push(`${token.prefix}${stringValue}${token.tail ? tailText(token.tail) : (token.suffix ?? '')}`)
        continue
      }
      const value = paramsInput[token.name]
      if (value === undefined && token.optional) continue
      // prefix, suffix and delimiter are URL-unreserved literals — encoding never changes them
      let encodedFirst = value === undefined ? 'undefined' : enc(Route0._serializeParamBestEffort(token, value))
      if (encodedFirst === '') {
        // an empty body must not reach the URL: the segment would collapse away and the SHORTER path could
        // exact-match a sibling route — a silent cross-route misroute, worse than a visibly broken link. An empty
        // optional param counts as absent; a required one degrades to the literal `undefined` like a missing one.
        if (token.optional) continue
        encodedFirst = 'undefined'
      }
      const after = token.tail ? tailText(token.tail) : (token.suffix ?? '')
      outSegments.push(`${token.prefix ?? ''}${encodedFirst}${after}`)
    }
    let url = outSegments.join('/')
    // A path that consumed no segments is the root — the bare definition, or one whose every token was optional and
    // left out. Restore it before the search string is appended, or the empty path drops out of the join.
    if (url === '') url = '/'
    // search params — a search object the stringifier chokes on (e.g. circular) drops out instead of throwing
    let searchString: string
    try {
      searchString = stringifySearchQuery(this._serializeSearchForBuild(searchInput), {
        arrayIndexes: false,
        encode,
      })
    } catch {
      searchString = ''
    }
    url = [url, searchString].filter(Boolean).join('?')
    // dedupe slashes
    url = collapseDuplicateSlashes(url)
    // absolute (origin already strips the trailing slash)
    if (absInput) {
      try {
        url = Route0._getAbsPath(absOriginInput || this.origin, url, encode)
      } catch {
        // an unset or malformed origin keeps the URL relative — get()/abs() are total, config errors included
      }
    }
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

  /** The parsed path, token by token. Frozen — see {@link routeTokens}. */
  getTokens(): readonly RouteToken[] {
    return this.routeTokens
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
      if (this.routeTokens.length > 0) {
        let pattern = ''
        const captureKeys: string[] = []
        // Driven off tokens (not raw definition parts) so param names and value constraints agree with `regex`.
        for (const token of this.routeTokens) {
          if (token.kind === 'param') {
            pattern += `/${escapeRegex(token.prefix ?? '')}(${Route0._firstBodyRegex(token)})${escapeRegex(token.suffix ?? '')}${token.tail ? Route0._tailRegexPiece(token.tail) : ''}`
            captureKeys.push(token.name)
            if (token.tail) captureKeys.push(token.tail.name)
          } else if (token.kind === 'wildcard') {
            // deliberately ignores the wildcard's suffix/tail: descendant checks ask "is this URL a shallower
            // prefix position of the route", and a first-segment approximation is all that question needs
            pattern += `/${escapeRegex(token.prefix)}[^/]*`
            captureKeys.push('*')
          } else {
            pattern += `/${escapeRegex(token.value)}`
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
        .flatMap((token) => {
          const first = token.kind === 'param' ? token.name : '*'
          return token.tail ? [first, token.tail.name] : [first]
        })
    }
    return this._captureKeys
  }

  private get routeSegments(): string[] {
    if (this._routeSegments === undefined) {
      this._routeSegments = Route0._getRouteSegments(this.definition)
    }
    return this._routeSegments
  }

  /**
   * The parsed path, and the single source every param-shaped view derives from.
   *
   * Frozen — tokens and the `values` array inside them are handed out by `getTokens()` and shared with
   * `paramsDefinition`, and a mutated `values` would widen what the schema accepts without widening what `regex`
   * matches.
   */
  /**
   * Regex body of a segment's FIRST param. Lazy for a plain first body with an optional tail — matching prefers the
   * tail present (`/talk.md` ⇒ slug `talk` + ext `md`), and since the tail's language never contains the delimiter,
   * lazy and greedy agree whenever a tail is there at all; they differ only on which side of "no tail" wins.
   */
  private static _firstBodyRegex(token: Extract<RouteToken, { kind: 'param' }>): string {
    if (token.tail?.optional && token.values === undefined && token.type === undefined) return '[^/]+?'
    return paramRegexBody(token.values, token.type)
  }

  /** The `delimiter(tailBody)` piece of a segment regex, optional as a group when the tail is optional. */
  private static _tailRegexPiece(tail: RouteTokenTail): string {
    const piece = `${escapeRegex(tail.delimiter)}(${paramRegexBody(tail.values, tail.type, tail.delimiter)})`
    return tail.optional ? `(?:${piece})?` : piece
  }

  /** Parsed tail → frozen token tail; `[str]` normalizes away, `values`/`type` stay absent when empty. */
  private static _buildTailToken(tail: ParsedParamTail): RouteTokenTail {
    const token: RouteTokenTail = { name: tail.name, optional: tail.optional, delimiter: tail.delimiter }
    if (tail.values) token.values = Object.freeze(tail.values) as readonly string[]
    else if (tail.typeName && tail.typeName !== 'str') token.type = tail.typeName as ParamTypeName
    return Object.freeze(token)
  }

  private get routeTokens(): readonly RouteToken[] {
    if (this._routeTokens === undefined) {
      this._routeTokens = Object.freeze(
        this.routeSegments.map((segment): RouteToken => {
          const param = parseParamSegment(segment)
          if (param) {
            // `values`/`type`/`prefix`/`suffix`/`tail` stay absent (not `undefined`) when they carry nothing, so
            // `getTokens()` keeps its shape; `[str]` is the explicit spelling of the default, so it normalizes away
            // here (validation ran already).
            const token: Extract<RouteToken, { kind: 'param' }> = {
              kind: 'param',
              name: param.name,
              optional: param.optional,
            }
            if (param.values) token.values = Object.freeze(param.values)
            else if (param.typeName && param.typeName !== 'str') token.type = param.typeName as ParamTypeName
            if (param.prefix) token.prefix = param.prefix
            if (param.suffix) token.suffix = param.suffix
            if (param.tail) token.tail = Route0._buildTailToken(param.tail)
            return Object.freeze(token)
          }
          const wildcard = segment.includes('\\*') ? undefined : parseWildcardSegment(segment)
          if (wildcard) {
            const token: Extract<RouteToken, { kind: 'wildcard' }> = {
              kind: 'wildcard',
              prefix: wildcard.prefix,
              optional: wildcard.optional,
            }
            if (wildcard.suffix) token.suffix = wildcard.suffix
            if (wildcard.tail) token.tail = Route0._buildTailToken(wildcard.tail)
            return Object.freeze(token)
          }
          return Object.freeze({ kind: 'static', value: segment })
        }),
      )
    }
    return this._routeTokens
  }

  /**
   * Every path param as a descriptor — what the public `params` field holds.
   *
   * The one name-keyed projection of {@link routeTokens}: required-ness and allowed values sit on the same object, so
   * validation and both JSON-schema emitters read a single structure. Frozen, and the `values` array is the token's own
   * — see the note there.
   */
  private get paramsDefinition(): Record<string, ParamDefinition> {
    if (this._paramsDefinition === undefined) {
      const makeDefinition = (
        required: boolean,
        values: readonly string[] | undefined,
        type: ParamTypeName | undefined,
      ): ParamDefinition =>
        Object.freeze(
          values
            ? { required, type: 'enum' as const, values }
            : type
              ? { required, type }
              : { required, type: 'string' as const },
        )
      const entries = this.routeTokens
        .filter((t) => t.kind !== 'static')
        .flatMap((t): Array<[string, ParamDefinition]> => {
          const list: Array<[string, ParamDefinition]> = [
            t.kind === 'param'
              ? [t.name, makeDefinition(!t.optional, t.values, t.type)]
              : ['*', makeDefinition(!t.optional, undefined, undefined)],
          ]
          if (t.tail) list.push([t.tail.name, makeDefinition(!t.tail.optional, t.tail.values, t.tail.type)])
          return list
        })
      this._paramsDefinition = Object.freeze(Object.fromEntries(entries))
    }
    return this._paramsDefinition
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
            // exactly one capture group per param (a tail param adds its own) — `captureKeys` maps groups to names
            // positionally; an optional affixed param drops the whole segment, prefix and suffix included
            const body = `${escapeRegex(token.prefix ?? '')}(${Route0._firstBodyRegex(token)})${escapeRegex(token.suffix ?? '')}${token.tail ? Route0._tailRegexPiece(token.tail) : ''}`
            pattern += token.optional ? `(?:/${body})?` : `/${body}`
            continue
          }
          if (token.suffix !== undefined || token.tail !== undefined) {
            // a wildcard with a literal suffix or a tail param demands a non-empty body; the body goes lazy when the
            // tail is optional — prefer pulling the tail out of the last segment over swallowing it
            const body = token.tail?.optional ? '(.+?)' : '(.+)'
            const after = token.tail ? Route0._tailRegexPiece(token.tail) : escapeRegex(token.suffix ?? '')
            pattern += `/${escapeRegex(token.prefix)}${body}${after}`
          } else if (token.prefix.length > 0) {
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

  /** Decoded captured value → the param's typed value (what `ParamsOutput` promises). */
  private _parseParamOutput(key: string, decoded: string): unknown {
    const def = this.paramsDefinition[key]
    if (def.type !== 'string' && def.type !== 'enum') return PARAM_TYPES[def.type].parse(decoded)
    return decoded
  }

  /**
   * `decodeURIComponent` that never throws: a malformed percent-sequence (`%GG`) comes back verbatim. The regex is the
   * sole matching authority and it matched — a matcher that then throws `URIError` from deep inside `getRelation` would
   * be worse than handing the raw value through.
   */
  private static _decodeParamValue(value: string): string {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  /** Positional capture values → typed params: decode, then convert per the param's descriptor. */
  private _extractParams(match: RegExpMatchArray, keys: string[]): Record<string, unknown> {
    const values = match.slice(1, 1 + keys.length)
    return Object.fromEntries(
      keys.map((key, index) => {
        const value = values[index] as string | undefined
        return [key, value === undefined ? undefined : this._parseParamOutput(key, Route0._decodeParamValue(value))]
      }),
    )
  }

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
      const params = this._extractParams(exactMatch, paramNames)
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
      const params = this._extractParams(ancestorMatch, paramNames)
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
      const params = this._extractParams(descendantMatch, descendantCaptureKeys)
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
    const paramsEntries = Object.entries(this.paramsDefinition)
    const requiredParamsKeys = paramsEntries.filter(([, def]) => def.required).map(([k]) => k)
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
    const data: Record<string, unknown> = {}
    for (const [k, def] of paramsEntries) {
      const v = inputObj[k]
      if (v === undefined && !def.required) {
        data[k] = undefined
        continue
      }
      if (def.type !== 'string' && def.type !== 'enum') {
        // Typed param: the canonical STRING form coerces to the typed value (everything on the wire is a string —
        // same as searchSchema), a typed value passes through as-is; the serialize gate rejects a wrong JS type and
        // any non-canonical value (1.5 for int, -1 for num, '007', Invalid Date, ...).
        if (typeof v === 'string' && _typeMatches(def.type, v)) {
          const parsed = PARAM_TYPES[def.type].parse(v)
          const gate = _serializeParamValue(def.type, parsed)
          // The round-trip gate rejects a coercion the engine mangled — most notably '2026-02-29', which some
          // engines roll over to March 1 (identity is required for [date]; [datetime] keeps its documented lenient
          // forms, where serialize legitimately differs from the input).
          if (!('error' in gate) && (def.type !== 'date' || gate.value === v)) {
            data[k] = parsed
            continue
          }
        }
        const result = _serializeParamValue(def.type, v)
        if ('error' in result) {
          return { issues: [{ message: `Invalid route params: "${k}" ${result.error}`, path: [k] }] }
        }
        data[k] = v
        continue
      }
      let value: string
      if (typeof v === 'string') {
        value = v
      } else if (typeof v === 'number') {
        value = String(v)
      } else {
        return {
          issues: [{ message: `Invalid route params: expected string, number, got ${typeof v} for "${k}"` }],
        }
      }
      // an empty value cannot appear in a path segment (a bare wildcard is the one matcher that CAN be empty)
      if (value === '' && k !== '*') {
        return {
          issues: [
            {
              message: `Invalid route params: "${k}" is an empty string — it cannot appear in a path segment`,
              path: [k],
            },
          ],
        }
      }
      if (def.type === 'enum' && !def.values.includes(value)) {
        return {
          issues: [
            {
              message:
                `Invalid route params: "${k}" must be one of ${def.values.map((a) => `"${a}"`).join(', ')} ` +
                `(received "${value}")`,
              path: [k],
            },
          ],
        }
      }
      data[k] = value
    }
    // The bijection guards (`get()` itself is best-effort by policy — the schema is where they bite). A wildcard
    // carrying a suffix or tail demands a non-empty body...
    for (const token of this.routeTokens) {
      if (token.kind === 'wildcard' && (token.suffix !== undefined || token.tail !== undefined) && data['*'] === '') {
        return {
          issues: [
            {
              message: `Invalid route params: "*" must be non-empty for a wildcard with a ${token.tail ? 'tail' : 'suffix'}`,
              path: ['*'],
            },
          ],
        }
      }
    }
    // ...a present plain-tail value must not contain its own delimiter (it would shift the split point on re-parse)...
    for (const token of this.routeTokens) {
      if (token.kind === 'static' || !token.tail) continue
      const tailValue = data[token.tail.name]
      if (
        typeof tailValue === 'string' &&
        token.tail.values === undefined &&
        token.tail.type === undefined &&
        tailValue.includes(token.tail.delimiter)
      ) {
        return {
          issues: [
            {
              message:
                `Invalid route params: "${token.tail.name}" value "${tailValue}" contains its delimiter ` +
                `"${token.tail.delimiter}" — a tail value cannot`,
              path: [token.tail.name],
            },
          ],
        }
      }
    }
    // ...and with an optional tail omitted, the first value must not re-parse as `body + delimiter + tail` — the URL
    // it builds would come back with a tail filled in.
    for (const token of this.routeTokens) {
      if (token.kind === 'static' || !token.tail || !token.tail.optional) continue
      if (data[token.tail.name] !== undefined) continue
      const firstKey = token.kind === 'param' ? token.name : '*'
      const firstValue = data[firstKey]
      if (firstValue === undefined) continue
      const def = this.paramsDefinition[firstKey]
      let canonical: string
      if (def.type !== 'string' && def.type !== 'enum') {
        const result = _serializeParamValue(def.type, firstValue)
        if ('error' in result) continue // unreachable — the value validated above
        canonical = result.value
      } else {
        canonical = String(firstValue)
      }
      const bodyKind = token.kind === 'wildcard' ? ('wildcard' as const) : ('segment' as const)
      const emitted = bodyKind === 'wildcard' ? canonical : encodeURIComponent(canonical)
      if (Route0._tailReparses(token.tail, bodyKind, emitted)) {
        return {
          issues: [
            {
              message:
                `Invalid route params: "${firstKey}" value "${canonical}" with "${token.tail.name}" omitted would ` +
                `re-parse with a "${token.tail.name}" tail — provide "${token.tail.name}" or change the value`,
              path: [firstKey],
            },
          ],
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
    const paramsEntries = Object.entries(this.paramsDefinition)
    const properties = Object.fromEntries(
      paramsEntries.map(([key, def]): [string, Record<string, unknown>] => [
        key,
        // A constrained param only ever accepts one of its string literals, so the number branch drops out —
        // matching the type level, where a constrained param loses `number`.
        def.type === 'enum'
          ? { type: 'string', enum: [...def.values] }
          : def.type !== 'string'
            ? { ...PARAM_TYPES[def.type].jsonSchemaInput }
            : { anyOf: [{ type: 'string' }, { type: 'number' }] },
      ]),
    )
    const required = paramsEntries.filter(([, def]) => def.required).map(([key]) => key)
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
      // mirrors the runtime, which tolerates (and ignores) unknown keys rather than failing on them;
      // the output schema below is the strict side — validated output only ever carries the declared params
      additionalProperties: true,
    }
  }

  private _getParamsOutputJSONSchema(options: StandardJSONSchemaV1.Options): Record<string, unknown> {
    const { target } = options
    const paramsEntries = Object.entries(this.paramsDefinition)
    const properties = Object.fromEntries(
      paramsEntries.map(([key, def]): [string, Record<string, unknown>] => [
        key,
        def.type === 'enum'
          ? { type: 'string', enum: [...def.values] }
          : def.type !== 'string'
            ? { ...PARAM_TYPES[def.type].jsonSchemaOutput }
            : { type: 'string' },
      ]),
    )
    const required = paramsEntries.filter(([, def]) => def.required).map(([key]) => key)
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

  /** One scalar search value → its typed value. Accepts the URL string form and the typed form alike. */
  private static _coerceSearchScalar(
    def: SearchParamDefinition,
    value: unknown,
  ): { value: unknown } | { error: string } {
    if (def.type === 'enum') {
      const stringValue = typeof value === 'number' ? String(value) : value
      if (typeof stringValue !== 'string' || !def.values.includes(stringValue)) {
        // _safeString: safeParse/validate must return issues even for a value whose toString throws
        return {
          error: `must be one of ${def.values.map((v) => `"${v}"`).join(', ')} (received "${Route0._safeString(value)}")`,
        }
      }
      return { value: stringValue }
    }
    if (def.type === 'string') {
      if (typeof value === 'string') return { value }
      if (typeof value === 'number') return { value: String(value) }
      return { error: `expected string, got ${typeof value}` }
    }
    if (typeof value === 'string') {
      if (!_typeMatches(def.type, value)) return { error: `expected [${def.type}] (canonical), got "${value}"` }
      const parsed = PARAM_TYPES[def.type].parse(value)
      const gate = _serializeParamValue(def.type, parsed)
      // same round-trip gate as the path schema: a parse the engine mangled (rolled-over '2026-02-29', an Invalid
      // Date) must not coerce silently
      if ('error' in gate || (def.type === 'date' && gate.value !== value)) {
        return { error: `expected [${def.type}] (canonical), got "${value}"` }
      }
      return { value: parsed }
    }
    const result = _serializeParamValue(def.type, value)
    if ('error' in result) return { error: result.error }
    return { value }
  }

  /**
   * Declared keys coerced: defaults filled, arrays wrapped (a single value counts as an array of one, an absent array
   * is `[]`), string forms parsed to their typed values. Unknown keys pass through in loose mode and are dropped in
   * strict mode. `lenient` (what a location's `search` gets) degrades an invalid value to the absent case instead of
   * failing — search never breaks matching.
   */
  private _coerceSearch(
    input: Record<string, unknown>,
    options: { lenient: boolean },
  ): { value: Record<string, unknown> } | { issues: Array<{ message: string; path?: string[] }> } {
    const defs = this.searchParams
    const output: Record<string, unknown> = {}
    const issues: Array<{ message: string; path?: string[] }> = []
    const keepUnknown = options.lenient || this.searchLoose
    for (const [key, value] of Object.entries(input)) {
      if (!(key in defs) && keepUnknown) output[key] = value
    }
    for (const [name, def] of Object.entries(defs)) {
      const raw = input[name]
      const absentValue = (): unknown => (def.array ? [] : 'default' in def ? def.default : undefined)
      if (raw === undefined) {
        if (def.required && !options.lenient) {
          issues.push({ message: `Invalid search params: "${name}" is required (received undefined)`, path: [name] })
          continue
        }
        output[name] = absentValue()
        continue
      }
      if (def.array) {
        const elements = Array.isArray(raw) ? raw : [raw]
        const coerced: unknown[] = []
        for (const element of elements) {
          const result = Route0._coerceSearchScalar(def, element)
          if ('error' in result) {
            if (!options.lenient) {
              issues.push({ message: `Invalid search params: "${name}" ${result.error}`, path: [name] })
              break
            }
            continue // lenient: an invalid element just drops out
          }
          coerced.push(result.value)
        }
        output[name] = coerced
        continue
      }
      const result = Route0._coerceSearchScalar(def, raw)
      if ('error' in result) {
        if (!options.lenient) {
          issues.push({ message: `Invalid search params: "${name}" ${result.error}`, path: [name] })
          continue
        }
        output[name] = absentValue()
        continue
      }
      output[name] = result.value
    }
    if (issues.length) return { issues }
    return { value: output }
  }

  /**
   * Best-effort typed view of a parsed search object: declared keys coerced per {@link searchParams}, invalid values
   * degrading to their absent case (default / `[]` / `undefined`), undeclared keys passing through. This is what the
   * collection's `getLocation` applies to `location.search` on an exact match. For hard validation use
   * {@link searchSchema}.
   */
  coerceSearch(input: Record<string, unknown>): Record<string, unknown> {
    const result = this._coerceSearch(input, { lenient: true })
    return 'value' in result ? result.value : input
  }

  private _validateSearchInput(input: unknown): StandardSchemaV1.Result<_SearchOutput<TDefinition>> {
    if (input === undefined) input = {}
    if (typeof input !== 'object' || input === null) {
      return { issues: [{ message: 'Invalid search params: expected object' }] }
    }
    const result = this._coerceSearch(input as Record<string, unknown>, { lenient: false })
    if ('issues' in result) return { issues: result.issues }
    return { value: result.value as _SearchOutput<TDefinition> }
  }

  private _searchScalarJSONSchema(def: SearchParamDefinition, side: 'input' | 'output'): Record<string, unknown> {
    if (def.type === 'enum') return { type: 'string', enum: [...def.values] }
    if (def.type === 'string') {
      return side === 'input' ? { anyOf: [{ type: 'string' }, { type: 'number' }] } : { type: 'string' }
    }
    const spec = PARAM_TYPES[def.type]
    // input additionally accepts the canonical string form, mirroring the coercion
    return side === 'input'
      ? { anyOf: [{ ...spec.jsonSchemaInput }, { type: 'string' }] }
      : { ...spec.jsonSchemaOutput }
  }

  private _getSearchJSONSchema(
    options: StandardJSONSchemaV1.Options,
    side: 'input' | 'output',
  ): Record<string, unknown> {
    const { target } = options
    const entries = Object.entries(this.searchParams)
    const properties = Object.fromEntries(
      entries.map(([name, def]): [string, Record<string, unknown>] => {
        const scalar = this._searchScalarJSONSchema(def, side)
        if (!def.array) return [name, scalar]
        // a single value counts as an array of one on the way in; the output is always a real array
        return [
          name,
          side === 'input' ? { anyOf: [scalar, { type: 'array', items: scalar }] } : { type: 'array', items: scalar },
        ]
      }),
    )
    const required =
      side === 'input'
        ? entries.filter(([, def]) => def.required).map(([name]) => name)
        : // the output always materializes required keys, defaulted keys and arrays
          entries.filter(([, def]) => def.required || def.array || 'default' in def).map(([name]) => name)
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
      // input mirrors the runtime, which tolerates unknown keys (strict mode drops them rather than failing);
      // the output is the honest side: strict output never carries extras, loose output may
      additionalProperties: side === 'input' ? true : this.searchLoose,
    }
  }

  /**
   * Standard Schema for the route's declared search params — the search-side sibling of `schema`.
   *
   * Accepts a parsed search object (raw strings from the URL and typed values alike), fills defaults, wraps arrays and
   * returns the typed output. Unknown keys pass through in loose mode and are dropped in strict mode.
   */
  readonly searchSchema: SchemaRoute0<UnknownSearchInput, _SearchOutput<TDefinition>> = {
    '~standard': {
      version: 1,
      vendor: 'route0',
      validate: (value) => this._validateSearchInput(value),
      jsonSchema: {
        input: (options) => this._getSearchJSONSchema(options, 'input'),
        output: (options) => this._getSearchJSONSchema(options, 'output'),
      },
      types: undefined as unknown as StandardSchemaV1.Types<UnknownSearchInput, _SearchOutput<TDefinition>>,
    },
    parse: (value) => this._parseSchemaResult(this._validateSearchInput(value)),
    safeParse: (value) => this._safeParseSchemaResult(this._validateSearchInput(value)),
  }

  /**
   * Standard Schema (+ Standard JSON Schema) for the route's path params — the LOUD counterpart to the never-throw
   * `get()`. `parse`/`safeParse` validate a params object: a plain param coerces `number` to its string, a typed param
   * takes its JS type or its canonical string form (`'3'` for `[int]`), an enum its literal — the output is exactly
   * `ParamsOutput`. All bijection guards bite here: non-canonical values, empty strings, ambiguous omitted tails and
   * delimiter-carrying tail values are validation errors.
   */
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
    return Route0._tokensOverlap(this.routeTokens, otherRoute.routeTokens)
  }

  /**
   * True when overlap is not resolvable by route ordering inside one route set.
   *
   * Overlapping routes are resolvable when one is uniformly more specific than the other across every shared segment
   * (e.g. `/users/impersonate/:id?` dominates `/users/:sn`, so it can simply be ordered first). A real conflict only
   * happens when specificity _crosses_ — each side wins some segment (e.g. `/:x/:id` vs `/x/:sn?`) — or when both
   * routes have equal specificity at the same depth (e.g. `/x/:id` vs `/x/:sn`).
   *
   * Caveat on the different-depth case: "resolvable by ordering" is right, but not because the shorter route's language
   * is a subset. When the shared prefix ends in an optional segment the two can properly cross — `/x/:p?` and
   * `/x/:p?/:q` share `/x/v` while each also owns URLs the other cannot match (`/x` and `/x/a/b`). Ordering still
   * decides it deterministically, and `_RANK_ABSENT` fixes which way, so this is reported as no conflict by design.
   *
   * Two typed params at the same position compare by their _languages_: identical languages (`:a[int]` vs `:b[bigint]`)
   * are indistinguishable by matching — a real conflict; nesting (`:a[int]` vs `:b[num]`) resolves by ordering the
   * narrower one first; crossing (`:a[num]` vs `:b[-int]` — both accept `5`, each owns values the other lacks) crosses
   * specificity, a real conflict; disjoint languages never overlap in the first place.
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
      else {
        // an affixed/tailed part is the properly narrower matcher; between two, more literal text is narrower —
        // this also orders wildcard variants (`/docs/*.md` before `/docs/*`), keeping them out of false conflicts
        const thisLiteral = Route0._partLiteralLength(thisParts[i])
        const otherLiteral = Route0._partLiteralLength(otherParts[i])
        if (thisLiteral === undefined || otherLiteral === undefined) continue
        if (thisLiteral !== otherLiteral) {
          if (thisLiteral > otherLiteral) thisMoreSpecific = true
          else otherMoreSpecific = true
          continue
        }
        const thisType = Route0._partTypeName(thisParts[i])
        const otherType = Route0._partTypeName(otherParts[i])
        let decided = false
        if (thisType && otherType) {
          const relation = _langRelation(PARAM_TYPES[thisType].lang, PARAM_TYPES[otherType].lang)
          if (relation === 'subset') {
            thisMoreSpecific = true
            decided = true
          } else if (relation === 'superset') {
            otherMoreSpecific = true
            decided = true
          } else if (relation === 'crossing') {
            thisMoreSpecific = true
            otherMoreSpecific = true
            decided = true
          }
          // 'equal' marks neither side — the tails below (or the same-depth rule) settle it
        }
        if (!decided) {
          // Same-delimiter tails compare by their constraints' value sets: a narrower tail (enum under a plain, a
          // subset language) resolves by ordering; a crossing pair is a real conflict; equal/disjoint mark neither
          // (disjoint pairs never overlapped in the first place). One-sided or differing-delimiter tails stay
          // undecided and fall to the same-depth rule.
          const thisTail = Route0._partTail(thisParts[i])
          const otherTail = Route0._partTail(otherParts[i])
          if (thisTail && otherTail && thisTail.delimiter === otherTail.delimiter) {
            const thisTailType =
              thisTail.typeName && thisTail.typeName !== 'str' ? (thisTail.typeName as ParamTypeName) : undefined
            const otherTailType =
              otherTail.typeName && otherTail.typeName !== 'str' ? (otherTail.typeName as ParamTypeName) : undefined
            const relation = _constraintRelation(thisTail.values, thisTailType, otherTail.values, otherTailType)
            if (relation === 'a-narrower') thisMoreSpecific = true
            else if (relation === 'b-narrower') otherMoreSpecific = true
            else if (relation === 'crossing') {
              thisMoreSpecific = true
              otherMoreSpecific = true
            }
          }
        }
      }
    }
    // Specificity crosses: each side wins some segment => unresolvable by ordering.
    if (thisMoreSpecific && otherMoreSpecific) return true
    // One side is uniformly more specific => strict subset => resolvable by ordering.
    if (thisMoreSpecific || otherMoreSpecific) return false
    // Equal specificity in the shared region: only same-depth routes are real conflicts (equal "languages").
    // Different depth is left to ordering — see the caveat above; it is not always a strict subset.
    return thisParts.length === otherParts.length
  }

  /** Specificity comparator used for deterministic route ordering. */
  isMoreSpecificThan(other: AnyRoute | string | undefined): boolean {
    if (!other) return false
    // `from`, not `create`: a route instance passes through untouched, so the O(n log n) comparisons of a
    // collection's ordering sort don't each construct (and re-validate) a throwaway clone
    const otherRoute = Route0.from(other)
    return Route0._compareSpecificity(this.definition, otherRoute.definition) < 0
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
        const result = Object.assign(location, {
          route: route.definition,
          params: relation.params,
        }) as ExactLocation
        if (Object.keys(route.searchParams).length > 0) {
          // the matched route declares search params — its coercion replaces the raw search view, still lazily
          let coercedSearch: Record<string, unknown> | undefined
          Object.defineProperty(result, 'search', {
            configurable: true,
            enumerable: true,
            get: () => {
              coercedSearch ??= route.coerceSearch(parseSearchQuery(result.searchString))
              return coercedSearch
            },
          })
        }
        return result
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
/**
 * What one path param accepts, as a discriminated union on `type` — the value type of {@link ParamsDefinition} and of
 * the public `route.params`.
 *
 * `type` is the param's _base type_: `'string'` (a plain or `[str]` param), `'enum'` (the one kind that also enumerates
 * its values), or one of the {@link ParamTypeName} names straight from the definition (`'int'`, `'-num'`, `'date'`,
 * ...), mirroring the shape both JSON-schema emitters produce.
 *
 * Deliberately _not_ the same shape as {@link RouteToken}: a token describes the path grammar the matcher walks, where
 * everything on the wire is a string, while a descriptor describes the contract of a param. The two live on different
 * levels and are meant to differ — do not "re-sync" them.
 */
export type ParamDefinition =
  | { required: boolean; type: 'string' }
  | { required: boolean; type: 'enum'; values: readonly string[] }
  | { required: boolean; type: ParamTypeName }

/**
 * What one declared search param accepts — the value type of the public `route.searchParams`, the search-side sibling
 * of {@link ParamDefinition}.
 *
 * On top of the shared `required`/`type` shape a search param can be an `array` (`&ids[int][]`) and can carry a
 * `default` (`&page[int]=0`) — stored parsed (a typed param's default is the typed value). A default is parse-side
 * only: it fills the absent case in `searchSchema`/`coerceSearch`, `get()` never inserts it into a URL.
 */
export type SearchParamDefinition = { required: boolean; array: boolean } & (
  | { type: 'string'; default?: string }
  | { type: 'enum'; values: readonly string[]; default?: string }
  | { type: ParamTypeName; default?: boolean | number | bigint | Date }
)

/** Every path param of a route, keyed by name. See {@link ParamDefinition} for the value. */
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
  [K in keyof ParamsDefinition<T>]: ParamsDefinition<T>[K] extends { required: true }
    ? _ParamOutputOf<ParamsDefinition<T>[K]>
    : _ParamOutputOf<ParamsDefinition<T>[K]> | undefined
}
export type ParamsInput<T extends AnyRoute | string = string> = _ParamsInput<Definition<T>>
export type IsParamsOptional<T extends AnyRoute | string> =
  HasRequiredParams<Definition<T>> extends true ? false : _HasRequiredSearch<Definition<T>> extends true ? false : true
export type ParamsInputStringOnly<T extends AnyRoute | string = string> = _ParamsInputStringOnly<Definition<T>>

// search — the standalone forms of the `Infer.Search*` members, taking a route or a definition string. A string
// carries no `.search<T>()` addition, so its `SearchInput` is the declared params alone.
export type SearchInput<T extends AnyRoute | string = string> =
  T extends Route0<infer TDef, infer TSearch>
    ? _SearchInputCombined<TDef, TSearch>
    : _SearchInputCombined<Definition<T>, UnknownSearchInput>
export type SearchInputStringOnly<T extends AnyRoute | string = string> = _SearchInputStringOnly<Definition<T>>
export type SearchOutput<T extends AnyRoute | string = string> = _SearchOutput<Definition<T>>
export type HasSearchDecls<T extends AnyRoute | string> = _HasSearchDecls<Definition<T>>

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
export type ExactLocation<TRoute extends AnyRoute | string = AnyRoute | string> = Omit<_GeneralLocation, 'search'> & {
  /** With search declarations on the route, the declared keys arrive coerced; otherwise the raw parse. */
  search: _LocationSearchOf<TRoute>
} & ExactLocationState<TRoute>

export type UnknownSearchParsedValue = string | UnknownSearchParsed | Array<UnknownSearchParsedValue>
export interface UnknownSearchParsed {
  [key: string]: UnknownSearchParsedValue
}

/**
 * The widest value a location's `search` can hold: the raw parse plus every form a declared search param coerces to.
 * This is what keeps `AnyLocation` the top of the location family — an `ExactLocation<T>` must stay assignable to it
 * for EVERY `T`, including a generic definition whose declared-search output is not yet known, so the generic fallback
 * in {@link _LocationSearchOf} types `search` as this instead of the raw-only {@link UnknownSearchParsed}.
 */
export type AnySearchParsedValue =
  string | number | boolean | bigint | Date | undefined | AnySearchParsed | Array<AnySearchParsedValue>
export interface AnySearchParsed {
  [key: string]: AnySearchParsedValue
}

export type UnknownSearchInput = Record<string, unknown>

/** Input URL is a descendant of route definition (route is ancestor). */
export type AncestorLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: IsAny<TRoute> extends true ? any : ParamsOutput<TRoute> & { [key: string]: unknown }
}
export type AncestorLocation<TRoute extends AnyRoute | string = AnyRoute | string> = _GeneralLocation &
  AncestorLocationState<TRoute>

/** It is when route not match at all, but params match. */
export type WeakAncestorLocationState<TRoute extends AnyRoute | string = AnyRoute | string> = {
  route: string
  params: IsAny<TRoute> extends true ? any : ParamsOutput<TRoute> & { [key: string]: unknown }
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

/** The path part of a definition — everything before the first `&` (search declarations). */
export type _PathOf<TDefinition extends string> = TDefinition extends `${infer TPath}&${string}` ? TPath : TDefinition

/** The raw search tail of a definition — everything after the first `&`, `''` when there is none. */
export type _SearchTailOf<TDefinition extends string> = TDefinition extends `${string}&${infer TTail}` ? TTail : ''

/** True when the definition ends with the loose `&` — undeclared search keys are then allowed alongside declared. */
export type _IsSearchLooseDefinition<TDefinition extends string> = TDefinition extends `${string}&` ? true : false

export type _ParamsDefinition<TDefinition extends string> = _ExtractParamsDefinitionBySegments<
  _SplitPathSegments<_PathOf<Definition<TDefinition>>>
>

export type _Simplify<T> = { [K in keyof T]: T[K] } & {}
export type _IfNoKeys<T extends object, TYes, TNo> = keyof T extends never ? TYes : TNo

export type _ParamsInput<TDefinition extends string> =
  _ParamsDefinition<TDefinition> extends infer TDef extends Record<string, ParamDefinition>
    ? _IfNoKeys<
        TDef,
        Record<never, never>,
        _Simplify<
          {
            [K in keyof TDef as TDef[K] extends { required: true } ? K : never]: _ParamInputOf<TDef[K]>
          } & {
            [K in keyof TDef as TDef[K] extends { required: false } ? K : never]?: _ParamInputOf<TDef[K]> | undefined
          }
        >
      >
    : Record<never, never>

export type _ParamsInputStringOnly<TDefinition extends string> =
  _ParamsDefinition<TDefinition> extends infer TDef extends Record<string, ParamDefinition>
    ? _IfNoKeys<
        TDef,
        Record<never, never>,
        _Simplify<
          {
            [K in keyof TDef as TDef[K] extends { required: true } ? K : never]: _ParamStringOf<TDef[K]>
          } & {
            [K in keyof TDef as TDef[K] extends { required: false } ? K : never]?: _ParamStringOf<TDef[K]> | undefined
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

/** What each param type accepts as `get()` input and yields as parsed output, keyed by {@link ParamTypeName}. */
export interface _ParamTypeValueMap {
  bool: { input: boolean; output: boolean }
  int: { input: number; output: number }
  '-int': { input: number; output: number }
  num: { input: number; output: number }
  '-num': { input: number; output: number }
  bigint: { input: bigint; output: bigint }
  '-bigint': { input: bigint; output: bigint }
  uuid: { input: string; output: string }
  date: { input: Date; output: Date }
  datetime: { input: Date; output: Date }
}

/**
 * Descriptor of one `:name[type]` segment. `[str]` is the explicit spelling of the default, so it normalizes to the
 * plain-string descriptor — matching the runtime, where the token drops the type entirely. An unknown type name also
 * degrades to the string descriptor at the type level: route creation throws for it anyway, and degrading beats
 * collapsing every other param to `never`.
 */
export type _TypedParamDescriptor<TRequired extends boolean, TType extends string> = TType extends 'str'
  ? { required: TRequired; type: 'string' }
  : TType extends ParamTypeName
    ? { required: TRequired; type: TType }
    : { required: TRequired; type: 'string' }

/** The characters a param name is made of — the boundary scanner below stops at the first anything-else. */
export type _ParamNameChar =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '_'

/**
 * The leading `[A-Za-z0-9_]+` run of a string — how the runtime's greedy name match splits a plain param from its
 * suffix (`'id.png'` ⇒ `'id'`). One recursion step per character; names are short.
 */
export type _TakeParamName<S extends string, TAcc extends string = ''> = S extends `${infer C}${infer Rest}`
  ? C extends _ParamNameChar
    ? _TakeParamName<Rest, `${TAcc}${C}`>
    : TAcc
  : TAcc

/**
 * Branch order is load-bearing twice over.
 *
 * The wildcard branch comes first because `:prefix*` is a wildcard carrying a prefix, not a param — a segment with a
 * `:` would otherwise claim it. Then any segment containing `:` is param intent (the literal prefix before the first
 * `:` never reaches the descriptor): a SECOND `:` inside it means a tail param (`:slug.:ext`) — the first body parses
 * as always-required (its trailing delimiter stops `_TakeParamName` naturally), and the trailing `?` belongs to the
 * tail there, not to the segment. Inside each body the constrained branches (enum, then type) precede the plain scan:
 * `_TakeParamName` would otherwise stop at `(`/`[` and happily accept the garbage tail as a suffix. What parses nowhere
 * yields no key — the runtime rejects such definitions at creation anyway.
 */
export type _ParamDefinitionFromSegment<TSegment extends string> = TSegment extends `${string}*${infer After}`
  ? _WildcardDefinitionFromAfter<After>
  : TSegment extends `${string}:${infer Tail}`
    ? Tail extends `${infer First}:${infer Second}`
      ? _ParamDefinitionFromParamBody<First, true> & _ParamDefinitionFromTailPart<Second>
      : Tail extends `${infer Body}?`
        ? _ParamDefinitionFromParamBody<Body, false>
        : _ParamDefinitionFromParamBody<Tail, true>
    : Record<never, never>

/** The tail param's descriptor: its own trailing `?` marks it optional. */
export type _ParamDefinitionFromTailPart<TTailPart extends string> = TTailPart extends `${infer TailBody}?`
  ? _ParamDefinitionFromParamBody<TailBody, false>
  : _ParamDefinitionFromParamBody<TTailPart, true>

/**
 * What follows the `*` of a wildcard segment: nothing, the optional `?`, a tail param (`.{tail}`), or a literal suffix.
 * The wildcard itself is `'*'`, required except in the bare `*?` spelling.
 */
export type _WildcardDefinitionFromAfter<TAfter extends string> = TAfter extends ''
  ? { '*': { required: true; type: 'string' } }
  : TAfter extends '?'
    ? { '*': { required: false; type: 'string' } }
    : TAfter extends `${string}:${infer TailPart}`
      ? { '*': { required: true; type: 'string' } } & _ParamDefinitionFromTailPart<TailPart>
      : { '*': { required: true; type: 'string' } }

export type _ParamDefinitionFromParamBody<
  TBody extends string,
  TRequired extends boolean,
> = TBody extends `${infer Name}(${infer Values})${string}`
  ? { [K in Name]: { required: TRequired; type: 'enum'; values: ReadonlyArray<_SplitAlternatives<Values>> } }
  : TBody extends `${infer Name}[${infer Type}]${string}`
    ? { [K in Name]: _TypedParamDescriptor<TRequired, Type> }
    : _TakeParamName<TBody> extends infer Name extends string
      ? Name extends ''
        ? Record<never, never>
        : { [K in Name]: { required: TRequired; type: 'string' } }
      : Record<never, never>

/** `'ru|en'` ⇒ `'ru' | 'en'`. Recurses once per alternative. */
export type _SplitAlternatives<S extends string> = S extends `${infer Head}|${infer Rest}`
  ? Head | _SplitAlternatives<Rest>
  : S

// One descriptor → its value types. Matched structurally (not indexed via `TDef['type']`) so they distribute over
// nothing and stay usable with the deferred `_ParamsDefinition` of a generic `TDefinition`. Branch order: enum first
// (it also has a `type` field), then typed, then the plain-string fallback.

/** What `get()` accepts for one param: enum literals, the type's input, or `string | number` for a plain param. */
export type _ParamInputOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : TDef extends { type: infer N extends ParamTypeName }
    ? _ParamTypeValueMap[N]['input']
    : string | number

/** What parsing yields for one param: enum literals, the type's output, or `string` for a plain param. */
export type _ParamOutputOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : TDef extends { type: infer N extends ParamTypeName }
    ? _ParamTypeValueMap[N]['output']
    : string

/** The canonical-string (URL) form of one param: enum literals stay literal, everything else is a `string`. */
export type _ParamStringOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : string

// search declarations, type level — the mirror of `parseSearchDecl`

/** Strips the loose trailing `&`(s) off a search tail: `'a&b&'` ⇒ `'a&b'`. */
export type _StripTrailingAmp<S extends string> = S extends `${infer H}&` ? _StripTrailingAmp<H> : S

/** Splits a decl tail on `&` into non-empty chunks. */
export type _SplitDecls<S extends string> = S extends ''
  ? []
  : S extends `${infer Head}&${infer Rest}`
    ? Head extends ''
      ? _SplitDecls<Rest>
      : [Head, ..._SplitDecls<Rest>]
    : [S]

/** Type-level search descriptor — `hasDefault` in place of the runtime's parsed `default` value. */
export type _SearchDescriptor = {
  required: boolean
  array: boolean
  hasDefault: boolean
  type: string
}

export type _TypedSearchDescriptor<
  TRequired extends boolean,
  TArray extends boolean,
  THasDefault extends boolean,
  TType extends string,
> = TType extends 'str'
  ? { required: TRequired; array: TArray; hasDefault: THasDefault; type: 'string' }
  : TType extends ParamTypeName
    ? { required: TRequired; array: TArray; hasDefault: THasDefault; type: TType }
    : { required: TRequired; array: TArray; hasDefault: THasDefault; type: 'string' }

/** Peels one search declaration outside-in: `=default`, then `!`, then `[]`, then the enum/type/name core. */
export type _SearchDeclDefinition<TDecl extends string> = TDecl extends `${infer Head}=${string}`
  ? _SearchDeclAfterDefault<Head, true>
  : _SearchDeclAfterDefault<TDecl, false>
type _SearchDeclAfterDefault<TDecl extends string, THasDefault extends boolean> = TDecl extends `${infer Head}!`
  ? _SearchDeclAfterRequired<Head, true, THasDefault>
  : _SearchDeclAfterRequired<TDecl, false, THasDefault>
type _SearchDeclAfterRequired<
  TDecl extends string,
  TRequired extends boolean,
  THasDefault extends boolean,
> = TDecl extends `${infer Head}[]`
  ? _SearchDeclCore<Head, TRequired, true, THasDefault>
  : _SearchDeclCore<TDecl, TRequired, false, THasDefault>
type _SearchDeclCore<
  TDecl extends string,
  TRequired extends boolean,
  TArray extends boolean,
  THasDefault extends boolean,
> = TDecl extends `${infer Name}(${infer Values})`
  ? {
      [K in Name]: {
        required: TRequired
        array: TArray
        hasDefault: THasDefault
        type: 'enum'
        values: ReadonlyArray<_SplitAlternatives<Values>>
      }
    }
  : TDecl extends `${infer Name}[${infer Type}]`
    ? { [K in Name]: _TypedSearchDescriptor<TRequired, TArray, THasDefault, Type> }
    : { [K in TDecl]: { required: TRequired; array: TArray; hasDefault: THasDefault; type: 'string' } }

export type _MergeSearchDecls<TDecls extends string[]> = TDecls extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? _SearchDeclDefinition<Head> & _MergeSearchDecls<Rest>
  : Record<never, never>

/** Every declared search param of a definition, keyed by name — the type-level face of `route.searchParams`. */
export type _SearchParamsDefinition<TDefinition extends string> = _MergeSearchDecls<
  _SplitDecls<_StripTrailingAmp<_SearchTailOf<Definition<TDefinition>>>>
>

/** What `get()`/schema accept for one declared search param, scalar level. */
export type _SearchScalarInputOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : TDef extends { type: infer N extends ParamTypeName }
    ? _ParamTypeValueMap[N]['input']
    : string | number

/** What parsing yields for one declared search param, scalar level. */
export type _SearchScalarOutputOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : TDef extends { type: infer N extends ParamTypeName }
    ? _ParamTypeValueMap[N]['output']
    : string

export type _SearchInputValueOf<TDef> = TDef extends { array: true }
  ? Array<_SearchScalarInputOf<TDef>>
  : _SearchScalarInputOf<TDef>
export type _SearchOutputValueOf<TDef> = TDef extends { array: true }
  ? Array<_SearchScalarOutputOf<TDef>>
  : _SearchScalarOutputOf<TDef>

/** True when the parsed output always carries the key: required, defaulted, or an array (absent ⇒ `[]`). */
export type _SearchAlwaysPresent<TDef> = TDef extends { required: true }
  ? true
  : TDef extends { hasDefault: true }
    ? true
    : TDef extends { array: true }
      ? true
      : false

/** The declared-keys object `get()`'s `?` accepts: required keys demanded, the rest opt-in. */
export type _SearchDeclsInput<TDefinition extends string> =
  _SearchParamsDefinition<TDefinition> extends infer TDefs extends Record<string, _SearchDescriptor>
    ? _Simplify<
        {
          [K in keyof TDefs as TDefs[K] extends { required: true } ? K : never]: _SearchInputValueOf<TDefs[K]>
        } & {
          [K in keyof TDefs as TDefs[K] extends { required: false } ? K : never]?:
            _SearchInputValueOf<TDefs[K]> | undefined
        }
      >
    : Record<never, never>

/** The canonical URL-string form of one declared search param: enum literals stay literal, all else is `string`. */
export type _SearchScalarStringOf<TDef> = TDef extends { type: 'enum'; values: ReadonlyArray<infer V extends string> }
  ? V
  : string
export type _SearchStringValueOf<TDef> = TDef extends { array: true }
  ? Array<_SearchScalarStringOf<TDef>>
  : _SearchScalarStringOf<TDef>

/**
 * The declared search params in their URL-string form — the search-side sibling of {@link _ParamsInputStringOnly}: every
 * scalar is its canonical string (enum literals stay literal), arrays are arrays of those. Loose mode admits extra
 * keys; without declarations any search object qualifies.
 */
export type _SearchInputStringOnly<TDefinition extends string> =
  _HasSearchDecls<TDefinition> extends true
    ? _Simplify<
        _SearchDeclsInputStringOnly<TDefinition> &
          (_IsSearchLooseDefinition<Definition<TDefinition>> extends true ? UnknownSearchInput : unknown)
      >
    : UnknownSearchInput

export type _SearchDeclsInputStringOnly<TDefinition extends string> =
  _SearchParamsDefinition<TDefinition> extends infer TDefs extends Record<string, _SearchDescriptor>
    ? _Simplify<
        {
          [K in keyof TDefs as TDefs[K] extends { required: true } ? K : never]: _SearchStringValueOf<TDefs[K]>
        } & {
          [K in keyof TDefs as TDefs[K] extends { required: false } ? K : never]?:
            _SearchStringValueOf<TDefs[K]> | undefined
        }
      >
    : Record<never, never>

/** The declared-keys object parsing yields: required/defaulted/array keys always there, the rest may be undefined. */
export type _SearchDeclsOutput<TDefinition extends string> =
  _SearchParamsDefinition<TDefinition> extends infer TDefs extends Record<string, _SearchDescriptor>
    ? _Simplify<
        {
          [K in keyof TDefs as _SearchAlwaysPresent<TDefs[K]> extends true ? K : never]: _SearchOutputValueOf<TDefs[K]>
        } & {
          [K in keyof TDefs as _SearchAlwaysPresent<TDefs[K]> extends false ? K : never]:
            _SearchOutputValueOf<TDefs[K]> | undefined
        }
      >
    : Record<never, never>

export type _HasSearchDecls<TDefinition extends string> =
  Definition<TDefinition> extends `${string}&${string}` ? true : false

export type _HasRequiredSearch<TDefinition extends string> =
  _SearchParamsDefinition<TDefinition> extends infer TDefs
    ? { [K in keyof TDefs]: TDefs[K] extends { required: true } ? K : never }[keyof TDefs] extends never
      ? false
      : true
    : false

/**
 * True only for the exact type `B` — not for mutually-assignable lookalikes. The invariance trick matters here:
 * `Record<string, unknown>` and any all-optional object are assignable BOTH ways, so `extends` cannot tell "the user
 * never called `.search<T>()`" (the default `UnknownSearchInput`) apart from a real all-optional `T`.
 */
export type _IsExactly<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false

/**
 * What `get()`'s `?` accepts, all sources combined: the declared keys, the `.search<T>()` addition, and — in loose mode
 * — anything else. Without declarations it is `.search<T>()`'s type alone, `UnknownSearchInput` by default.
 */
export type _SearchInputCombined<TDefinition extends string, TSearchInput extends UnknownSearchInput> =
  _HasSearchDecls<TDefinition> extends true
    ? _Simplify<
        _SearchDeclsInput<TDefinition> &
          (_IsExactly<TSearchInput, UnknownSearchInput> extends true ? unknown : TSearchInput) &
          (_IsSearchLooseDefinition<Definition<TDefinition>> extends true ? UnknownSearchInput : unknown)
      >
    : TSearchInput

/** `searchSchema`'s output: the declared keys, plus anything at all when the route is loose. */
export type _SearchOutput<TDefinition extends string> =
  _HasSearchDecls<TDefinition> extends true
    ? _Simplify<
        _SearchDeclsOutput<TDefinition> &
          (_IsSearchLooseDefinition<Definition<TDefinition>> extends true ? UnknownSearchInput : unknown)
      >
    : UnknownSearchInput

/** Constraint for `.search<T>()`: any search shape, minus the keys the definition already declares. */
export type _SearchInputAddition<TDefinition extends string> = UnknownSearchInput & {
  [K in keyof _SearchParamsDefinition<TDefinition>]?: never
}

/**
 * What an exact location's `search` holds: declared keys typed (extras {@link AnySearchParsedValue}), the raw parse
 * without decls, or — for a generic definition (`string`, `any`) — the wide {@link AnySearchParsed}. The generic branch
 * comes first so `ExactLocation<T>` with an unresolved `T` provably extends `AnyLocation`: every branch below it is
 * assignable to `AnySearchParsed`, which is exactly what `AnyLocation`'s own member resolves to.
 */
export type _LocationSearchOf<TRoute extends AnyRoute | string> =
  IsAny<TRoute> extends true
    ? any
    : string extends Definition<TRoute>
      ? AnySearchParsed
      : _HasSearchDecls<Definition<TRoute>> extends true
        ? _Simplify<_SearchDeclsOutput<Definition<TRoute>> & AnySearchParsed>
        : UnknownSearchParsed

export type _MergeParamDefinitions<
  A extends Record<string, ParamDefinition>,
  B extends Record<string, ParamDefinition>,
> = {
  [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never
}

export type _ExtractParamsDefinitionBySegments<TSegments extends string[]> = TSegments extends [
  infer Segment extends string,
  ...infer Rest extends string[],
]
  ? _MergeParamDefinitions<_ParamDefinitionFromSegment<Segment>, _ExtractParamsDefinitionBySegments<Rest>>
  : Record<never, never>

export type _RequiredParamKeys<TDefinition extends string> = {
  [K in keyof _ParamsDefinition<TDefinition>]: _ParamsDefinition<TDefinition>[K] extends { required: true } ? K : never
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
/** Slash-normalizes the path part; the search declarations (from the first `&`) stay verbatim. */
export type NormalizeRouteDefinition<S extends string> = S extends `${infer TPath}&${infer TSearch}`
  ? `${_NormalizePathPart<TPath>}&${TSearch}`
  : _NormalizePathPart<S>
export type _NormalizePathPart<S extends string> = TrimTrailingSlash<EnsureLeadingSlash<DedupeSlashes<S>>>
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
/** Merged search suffix of an extension: both sides' declarations concatenated, loose when either side is loose. */
export type _ExtendedSearchSuffix<TSource extends string, TSuffix extends string> =
  _JoinDeclChunks<
    _StripTrailingAmp<_SearchTailOf<TSource>>,
    _StripTrailingAmp<_SearchTailOf<TSuffix>>
  > extends infer TDecls extends string
    ? _EitherSearchLoose<TSource, TSuffix> extends true
      ? TDecls extends ''
        ? '&'
        : `&${TDecls}&`
      : TDecls extends ''
        ? ''
        : `&${TDecls}`
    : never
export type _JoinDeclChunks<A extends string, B extends string> = A extends '' ? B : B extends '' ? A : `${A}&${B}`
export type _EitherSearchLoose<A extends string, B extends string> =
  _IsSearchLooseDefinition<A> extends true ? true : _IsSearchLooseDefinition<B>

/** An extended definition: paths joined (a trailing wildcard gives way), search declarations concatenated. */
export type PathExtended<
  TSourceDefinition extends string,
  TSuffixDefinition extends string,
> = `${NormalizeRouteDefinition<JoinPath<StripTrailingWildcard<_PathOf<TSourceDefinition>>, _PathOf<TSuffixDefinition>>>}${_ExtendedSearchSuffix<TSourceDefinition, TSuffixDefinition>}`

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
> = _ParamsInput<TDefinition> &
  (_HasRequiredSearch<TDefinition> extends true
    ? { '?': _SearchInputCombined<TDefinition, TSearchInput> }
    : { '?'?: _SearchInputCombined<TDefinition, TSearchInput> }) & {
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
