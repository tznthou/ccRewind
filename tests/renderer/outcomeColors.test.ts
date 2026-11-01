import { describe, it, expect } from 'vitest'
import {
  DISTRIBUTION_KEY_TO_OUTCOME,
  OUTCOME_COLORS,
  OUTCOME_I18N_KEY,
  OUTCOME_KEYS,
  outcomeKeyOf,
  type OutcomeKey,
} from '../../src/renderer/components/Dashboard/outcomeColors'

const EXPECTED_OUTCOMES: readonly OutcomeKey[] = [
  'committed',
  'tested',
  'in-progress',
  'quick-qa',
  'unknown',
]

describe('outcomeColors module', () => {
  it('OUTCOME_KEYS lists every outcome exactly once in stable order', () => {
    expect(OUTCOME_KEYS).toEqual(EXPECTED_OUTCOMES)
  })

  it('OUTCOME_COLORS provides a non-empty color for every outcome', () => {
    for (const key of EXPECTED_OUTCOMES) {
      expect(OUTCOME_COLORS[key], `missing color for ${key}`).toBeTypeOf('string')
      expect(OUTCOME_COLORS[key].length).toBeGreaterThan(0)
    }
  })

  it('OUTCOME_I18N_KEY maps every outcome to a dashboard.outcome.* key', () => {
    for (const key of EXPECTED_OUTCOMES) {
      expect(OUTCOME_I18N_KEY[key]).toMatch(/^dashboard\.outcome\./)
    }
  })

  it('DISTRIBUTION_KEY_TO_OUTCOME maps the five camelCase keys onto the five outcome keys', () => {
    const distributionKeys = Object.keys(DISTRIBUTION_KEY_TO_OUTCOME).sort()
    expect(distributionKeys).toEqual(['committed', 'inProgress', 'quickQa', 'tested', 'unknown'])
    const mappedOutcomes = Object.values(DISTRIBUTION_KEY_TO_OUTCOME).sort()
    expect(mappedOutcomes).toEqual([...EXPECTED_OUTCOMES].sort())
  })
})

// The unresolved-session badge used to take its inline background from resolveOutcomeColor(). Its colours now live in
// CSS tokens chosen by a data-outcome attribute, so what the component needs is the normalised key, not a colour.
describe('outcomeKeyOf', () => {
  it('returns each known outcome string unchanged', () => {
    for (const key of EXPECTED_OUTCOMES) {
      expect(outcomeKeyOf(key)).toBe(key)
    }
  })

  it('falls back to unknown for null, undefined and an empty string', () => {
    expect(outcomeKeyOf(null)).toBe('unknown')
    expect(outcomeKeyOf(undefined)).toBe('unknown')
    expect(outcomeKeyOf('')).toBe('unknown')
  })

  it('falls back to unknown for an unrecognized status string', () => {
    expect(outcomeKeyOf('shipped')).toBe('unknown')
  })

  it('does not match camelCase distribution keys directly', () => {
    expect(outcomeKeyOf('inProgress')).toBe('unknown')
    expect(outcomeKeyOf('quickQa')).toBe('unknown')
  })

  // `status in OUTCOME_COLORS` (the old lookup) is also true for inherited keys, which would have handed a function to
  // the badge as its colour
  it('does not treat Object.prototype keys as outcomes', () => {
    expect(outcomeKeyOf('toString')).toBe('unknown')
    expect(outcomeKeyOf('constructor')).toBe('unknown')
    expect(outcomeKeyOf('__proto__')).toBe('unknown')
  })
})
