import assert from 'node:assert/strict'
import test from 'node:test'

import { extractPalletCode } from './pallet-code.ts'

test('plain pallet serials pass through', () => {
  assert.equal(extractPalletCode('J3JV'), 'J3JV')
  assert.equal(extractPalletCode('5TJQ'), '5TJQ')
})

test('reprinted serials KEEP the -NN suffix (2026-07-08 ship-flow incident)', () => {
  assert.equal(extractPalletCode('33R5-02'), '33R5-02')
  assert.equal(extractPalletCode('3PAW-02'), '3PAW-02')
  assert.equal(extractPalletCode('D79C-123'), 'D79C-123')
})

test('lowercase and padded input normalizes', () => {
  assert.equal(extractPalletCode('  33r5-02  '), '33R5-02')
  assert.equal(extractPalletCode('j3jv'), 'J3JV')
})

test('prefixed payloads take the segment after the last comma', () => {
  assert.equal(extractPalletCode('QA,5TJQ'), '5TJQ')
  assert.equal(extractPalletCode('something,else,5TJQ-02'), '5TJQ-02')
})

test('part-number-ish scans behave exactly as before suffix support', () => {
  // 'U' is not Crockford base32, so CURB never matched; the first valid run wins.
  assert.equal(extractPalletCode('CURB-36PK'), '36PK')
  assert.equal(extractPalletCode('EB-6PK-RED-AO'), '6PK')
})

test('no match falls back to trimmed uppercase raw', () => {
  assert.equal(extractPalletCode(' eb '), 'EB')
})
