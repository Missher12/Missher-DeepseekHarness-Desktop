/** Composition revision allocation: monotonic per profile, never reused. */
import { describe, expect, it } from 'vitest'
import {
  applyProfileComposition, presetEnhancementOrigin, profileCompositionRevision,
  type ProfileContext, type ProfilePatchLayer,
} from '../src/index.ts'

function profile(name: string): ProfileContext {
  return {
    name, dir: `/tmp/${name}`, patchPath: `/tmp/${name}/cordis.patch.yml`, installAnchor: '/tmp/install/package.json',
    cwd: `/tmp/${name}`, home: `/tmp/${name}-home`, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  }
}

function layer(rowId: string, trust = true): ProfilePatchLayer {
  return {
    origin: { kind: 'bundle', label: 'test-bundle', trusted: trust, installAnchor: '/tmp/install/package.json' },
    patches: [{ insert: [{ id: rowId, name: '@deepseek-ai/dsh-agent-preset', config: { id: rowId, plugins: [] } }] }],
    revision: 0,
  }
}

describe('composition revision allocation', () => {
  it('never reuses a revision a rollback restored', () => {
    const context = profile('rollback')
    const first = applyProfileComposition(context, [layer('preset-one')])
    expect(first.revision).toBe(1)
    first.rollback()
    expect(profileCompositionRevision(context)).toBe(0)

    // A different composition must not inherit the rolled-back identity.
    const second = applyProfileComposition(context, [layer('preset-two')])
    expect(second.revision).toBe(2)
    expect(profileCompositionRevision(context)).toBe(2)
    expect(presetEnhancementOrigin(context, 'preset-one')?.reason)
      .toBe('the applied composition declares no origin for this row')
  })

  it('keeps identical inputs on their own identity', () => {
    const context = profile('identical')
    const layers = [layer('preset-one')]
    const first = applyProfileComposition(context, layers)
    const again = applyProfileComposition(context, layers)
    expect(again.revision).toBe(first.revision)
    expect(presetEnhancementOrigin(context, 'preset-one')?.trusted).toBe(true)
  })

  it('keeps two profiles on separate counters', () => {
    const left = profile('left')
    const right = profile('right')
    expect(applyProfileComposition(left, [layer('preset-one')]).revision).toBe(1)
    expect(applyProfileComposition(right, [layer('preset-two')]).revision).toBe(1)
    expect(applyProfileComposition(left, [layer('preset-three')]).revision).toBe(2)
    expect(profileCompositionRevision(right)).toBe(1)
  })

  it('reports an untrusted layer as an unvouched decision', () => {
    const context = profile('untrusted')
    applyProfileComposition(context, [layer('preset-one', false)])
    const origin = presetEnhancementOrigin(context, 'preset-one')
    expect(origin?.trusted).toBe(false)
    expect(origin?.revision).toBe(1)
  })
})
