import type { SuiClientTypes } from '@mysten/sui/client'
import { describe, expect, it } from 'vitest'
import { buyErrorMessage, executionErrorMessage } from './buyErrors'

const abort = (abortCode: string, module = 'marketplace') =>
  ({
    $kind: 'MoveAbort',
    message: `MoveAbort in ${module} with code ${abortCode}`,
    MoveAbort: { abortCode, location: { module } },
  }) as SuiClientTypes.ExecutionError

describe('executionErrorMessage', () => {
  it('maps marketplace abort codes', () => {
    expect(executionErrorMessage(abort('1'))).toBe('Price changed, reload')
    expect(executionErrorMessage(abort('2'))).toBe('Sold out')
    expect(executionErrorMessage(abort('3'))).toBe('No longer for sale')
  })

  it('falls back to the chain message for other aborts and modules', () => {
    expect(executionErrorMessage(abort('0'))).toBe('MoveAbort in marketplace with code 0')
    expect(executionErrorMessage(abort('2', 'balance'))).toBe('MoveAbort in balance with code 2')
    expect(executionErrorMessage(null)).toBe('The transaction failed on-chain.')
  })
})

describe('buyErrorMessage', () => {
  it('recognises a wallet rejection', () => {
    expect(buyErrorMessage(new Error('User rejected the request.'))).toBe('You cancelled the request in your wallet.')
  })

  it('recognises a low balance', () => {
    expect(buyErrorMessage(new Error('Insufficient balance of 0x2::sui::SUI'))).toMatch(/Not enough SUI/)
  })

  it('passes other messages through', () => {
    expect(buyErrorMessage(new Error('fetch failed'))).toBe('fetch failed')
    expect(buyErrorMessage(undefined)).toBe('Something went wrong. Try again.')
  })
})
