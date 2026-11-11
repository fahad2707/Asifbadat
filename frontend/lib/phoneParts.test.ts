import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinPhone, phoneDigitsForWhatsApp, splitPhone } from './phoneParts';

test('splits a stored US number into calling code and national number', () => {
  assert.deepEqual(splitPhone('+1 2155550100'), { callingCode: '+1', nationalNumber: '2155550100' });
});

test('splits +91 before treating remaining digits as the number', () => {
  assert.deepEqual(splitPhone('+919876543210'), { callingCode: '+91', nationalNumber: '9876543210' });
});

test('joins calling code and number for storage', () => {
  assert.equal(joinPhone('+91', '98765 43210'), '+91 9876543210');
});

test('whatsapp digits drop spaces and plus', () => {
  assert.equal(phoneDigitsForWhatsApp('+91 9876543210'), '919876543210');
});
