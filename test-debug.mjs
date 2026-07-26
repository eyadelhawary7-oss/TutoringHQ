// Quick script to test the actual response body
// Run with: node test-debug.mjs

import { getUpgradeCost } from './dist/lib/billingEngine.js';

// Test scenario from switchGuardrails.test.ts G6 test
const today = new Date('2026-07-26');
const nextPaymentDue = new Date('2026-07-20');

console.log('Today:', today.toISOString().slice(0, 10));
console.log('Next Payment Due:', nextPaymentDue.toISOString().slice(0, 10));

// Calculate days remaining
const todayMidnight = new Date(today);
todayMidnight.setHours(0, 0, 0, 0);
const dueMidnight = new Date(nextPaymentDue);
dueMidnight.setHours(0, 0, 0, 0);
const daysRemaining = Math.max(0, Math.floor((dueMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)));

console.log('Days Remaining:', daysRemaining);
console.log('');

// Prices
const proMonthly = 7999;  // PLANS.pro.quarterlyAllIn
const businessMonthly = 12999;  // PLANS.business.quarterlyAllIn

console.log('Pro (current) monthly:', proMonthly);
console.log('Business (target) monthly:', businessMonthly);

// Daily rates
const proDailyRate = proMonthly / 30;
const businessDailyRate = businessMonthly / 30;
const dailyRateDifference = businessDailyRate - proDailyRate;

console.log('Pro daily rate:', proDailyRate.toFixed(2));
console.log('Business daily rate:', businessDailyRate.toFixed(2));
console.log('Daily rate difference:', dailyRateDifference.toFixed(2));

// Amount due
const amountDue = dailyRateDifference * daysRemaining;
console.log('Amount due (dailyRateDifference × daysRemaining):', amountDue.toFixed(2));
console.log('');
console.log('Route logic: if (amountDue <= 0) return 400');
console.log('amountDue <= 0?', amountDue <= 0);
console.log('Expected response body: { error: "This would not increase your plan cost. Use the Downgrade tab.", code: "USE_DOWNGRADE" }');
console.log('Expected status: 400');
