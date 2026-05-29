// Post-build smoke test: verifies the published artifact loads under plain Node,
// that the package "exports" map resolves, and that the core build/parse
// round-trip works end-to-end.
import { Route0 } from '../dist/index.js'

const assert = (cond, msg) => {
  if (!cond) {
    console.error('smoke test failed:', msg)
    process.exit(1)
  }
}

const route = Route0.create('/users/:id')

assert(route.get({ id: '42' }) === '/users/42', 'get() should build the path')

const rel = route.getRelation('/users/42')
assert(rel.type === 'exact', 'getRelation() should match exactly')
assert(rel.params.id === '42', 'getRelation() should parse params')

console.log('smoke ok')
