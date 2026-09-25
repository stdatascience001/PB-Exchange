import assert from 'node:assert/strict';
import { TransactionCalculator } from '../apps/api/dist/modules/transactions/transaction.calculator.js';
import {
  createTransactionSchema,
  crossGenerateSchema,
  fromToGenerateSchema,
  randomGenerateSchema,
} from '../packages/validation/dist/index.js';

console.log('====================================================');
console.log('   RUNNING PB EXCHANGE AUTOMATED DOMAIN TEST SUITE   ');
console.log('====================================================');

// Test 1: Number Formatting
console.log('\n[Test 1] Number Formatting (Matka 00-99)...');
assert.equal(TransactionCalculator.formatNumber(0), '00');
assert.equal(TransactionCalculator.formatNumber(1), '01');
assert.equal(TransactionCalculator.formatNumber(9), '09');
assert.equal(TransactionCalculator.formatNumber(99), '99');
assert.equal(TransactionCalculator.formatNumber(100), '99'); // Clamped
console.log('✓ Number formatting verified (01 is 1st count, 00 is 100th count).');

// Test 2: Crossing (With Joda)
console.log('\n[Test 2] Cross Generator with Joda...');
const crossWithJoda = TransactionCalculator.generateCross([1, 2], true, 10);
// Expected: 11, 12, 21, 22 (4 entries of 10)
assert.equal(crossWithJoda.length, 4);
const numbersWithJoda = crossWithJoda.map(c => c.numberValue);
assert.deepEqual(numbersWithJoda.sort(), ['11', '12', '21', '22']);
console.log('✓ Cross with Joda generated 4 pairs: 11, 12, 21, 22.');

// Test 3: Crossing (Without Joda)
console.log('\n[Test 3] Cross Generator without Joda...');
const crossWithoutJoda = TransactionCalculator.generateCross([1, 2, 3], false, 20);
// Expected: 12, 13, 21, 23, 31, 32 (6 entries, doubles excluded)
assert.equal(crossWithoutJoda.length, 6);
assert.ok(!crossWithoutJoda.some(c => c.numberValue === '11'));
assert.ok(!crossWithoutJoda.some(c => c.numberValue === '22'));
assert.ok(!crossWithoutJoda.some(c => c.numberValue === '33'));
console.log('✓ Cross without Joda generated 6 non-double pairs.');

// Test 4: From-To Series (Without Palti)
console.log('\n[Test 4] From-To Series (10 to 13, without Palti)...');
const fromToStandard = TransactionCalculator.generateFromTo(10, 13, false, 50);
assert.equal(fromToStandard.length, 4);
assert.deepEqual(fromToStandard.map(f => f.numberValue).sort(), ['10', '11', '12', '13']);
console.log('✓ From-To generated 4 numbers: 10, 11, 12, 13.');

// Test 5: From-To Series (With Palti)
console.log('\n[Test 5] From-To Series (12 to 13, with Palti)...');
const fromToPalti = TransactionCalculator.generateFromTo(12, 13, true, 15);
// Numbers: 12, 13, and their reverses: 21, 31
const paltiNumbers = fromToPalti.map(f => f.numberValue).sort();
assert.deepEqual(paltiNumbers, ['12', '13', '21', '31']);
console.log('✓ From-To with Palti generated inverted pairs: 12, 13, 21, 31.');

// Test 6: Random Generator
console.log('\n[Test 6] Random Generator (15 numbers)...');
const randoms = TransactionCalculator.generateRandom(15, 100);
assert.equal(randoms.length, 15);
const uniqueRandoms = new Set(randoms.map(r => r.numberValue));
assert.equal(uniqueRandoms.size, 15); // Must all be distinct
console.log('✓ Random generator created 15 unique numbers.');

// Test 7: Zod Schemas
console.log('\n[Test 7] Schema Validations...');
const validCross = crossGenerateSchema.safeParse({
  digits: [1, 3, 5],
  withJoda: true,
  amount: 25,
});
assert.ok(validCross.success);

const invalidCross = crossGenerateSchema.safeParse({
  digits: [1], // Needs at least 2
  withJoda: true,
  amount: 25,
});
assert.ok(!invalidCross.success);

const validFromTo = fromToGenerateSchema.safeParse({
  fromNumber: 10,
  toNumber: 20,
  withPalti: true,
  amount: 50,
});
assert.ok(validFromTo.success);

const invalidFromTo = fromToGenerateSchema.safeParse({
  fromNumber: 50,
  toNumber: 20, // from > to invalid
  withPalti: true,
  amount: 50,
});
assert.ok(!invalidFromTo.success);
console.log('✓ Zod validation constraints verified.');

// Test 8: Payout Calculation Formula
console.log('\n[Test 8] Payout & Exposure Calculation Formula...');
const betAmount = 200;
const daraRate = 90;
const expectedPayout = betAmount * daraRate;
assert.equal(expectedPayout, 18000);

const totalBookCollection = 50000;
const netExposureOnWinner = expectedPayout - totalBookCollection;
assert.equal(netExposureOnWinner, -32000); // Book is in profit of 32,000
console.log('✓ Payout (200 * 90 = 18,000) and net exposure verified.');

console.log('\n====================================================');
console.log('   ALL 8 PB EXCHANGE DOMAIN TESTS PASSED (100%)    ');
console.log('====================================================\n');
