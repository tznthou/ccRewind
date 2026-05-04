import { describe, it, expect } from 'vitest'
import {
  DISTRIBUTION_KEY_TO_OUTCOME,
  OUTCOME_COLORS,
  OUTCOME_I18N_KEY,
  OUTCOME_KEYS,
  resolveOutcomeColor,
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

describe('resolveOutcomeColor', () => {
  it('returns the matching color for each known outcome string', () => {
    for (const key of EXPECTED_OUTCOMES) {
      expect(resolveOutcomeColor(key)).toBe(OUTCOME_COLORS[key])
    }
  })

  it('falls back to the unknown color for null', () => {
    expect(resolveOutcomeColor(null)).toBe(OUTCOME_COLORS.unknown)
  })

  it('falls back to the unknown color for undefined', () => {
    expect(resolveOutcomeColor(undefined)).toBe(OUTCOME_COLORS.unknown)
  })

  it('falls back to the unknown color for an empty string', () => {
    expect(resolveOutcomeColor('')).toBe(OUTCOME_COLORS.unknown)
  })

  it('falls back to the unknown color for an unrecognized status string', () => {
    expect(resolveOutcomeColor('shipped')).toBe(OUTCOME_COLORS.unknown)
  })

  it('does not match camelCase distribution keys directly', () => {
    expect(resolveOutcomeColor('inProgress')).toBe(OUTCOME_COLORS.unknown)
    expect(resolveOutcomeColor('quickQa')).toBe(OUTCOME_COLORS.unknown)
  })
})
