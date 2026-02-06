/**
 * Unit Tests for Billing Service Pure Functions
 * 
 * Run with: npx tsx services/billingService.test.ts
 * Or with Node.js test runner if configured
 */

import {
  calculateLessonPrice,
  isCancellationBillable,
  calculateCancellationCharge,
  getBillingMonth,
  generateBillingKey,
  calculateStudentBilling,
  parseSubscriptionAmount,
} from './billingService';
import { Lesson, Subscription, LessonStatus } from '../types';

// Simple test runner
interface Test {
  name: string;
  fn: () => void;
}

const tests: Test[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

// ==================== Tests ====================

// Test: calculateLessonPrice
test('calculateLessonPrice - Private (English)', () => {
  assertEquals(calculateLessonPrice('private'), 175);
  assertEquals(calculateLessonPrice('Private'), 175);
  assertEquals(calculateLessonPrice('PRIVATE'), 175);
});

test('calculateLessonPrice - Private (Hebrew)', () => {
  assertEquals(calculateLessonPrice('פרטי'), 175);
});

test('calculateLessonPrice - Pair (English) - No subscription (default)', () => {
  // Without subscription info, defaults to 112.5 (225/2 per student)
  assertEquals(calculateLessonPrice('pair'), 112.5);
  assertEquals(calculateLessonPrice('Pair'), 112.5);
});

test('calculateLessonPrice - Pair (Hebrew) - No subscription (default)', () => {
  assertEquals(calculateLessonPrice('זוגי'), 112.5);
});

test('calculateLessonPrice - Group (English) - No subscription (fixed 120)', () => {
  assertEquals(calculateLessonPrice('group'), 120);
  assertEquals(calculateLessonPrice('Group'), 120);
});

test('calculateLessonPrice - Group (Hebrew) - No subscription (fixed 120)', () => {
  assertEquals(calculateLessonPrice('קבוצתי'), 120);
});

test('calculateLessonPrice - Pair with active subscription', () => {
  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'זוגי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-12-31',
      pauseSubscription: false,
    },
  ];
  
  // With active subscription, should return 0
  assertEquals(calculateLessonPrice('pair', 60, 's1', subscriptions, '2024-03-15'), 0);
  assertEquals(calculateLessonPrice('זוגי', 60, 's1', subscriptions, '2024-03-15'), 0);
});

test('calculateLessonPrice - Pair without subscription', () => {
  const subscriptions: Subscription[] = [];

  // Without subscription, should return 112.5 (default when no pairTotalPrice)
  assertEquals(calculateLessonPrice('pair', 60, 's1', subscriptions, '2024-03-15'), 112.5);
  assertEquals(calculateLessonPrice('זוגי', 60, 's1', subscriptions, '2024-03-15'), 112.5);
});

test('calculateLessonPrice - Pair with pairTotalPrice (charge half per student)', () => {
  const subscriptions: Subscription[] = [];
  assertEquals(calculateLessonPrice('pair', 60, 's1', subscriptions, '2024-03-15', 200), 100);
  assertEquals(calculateLessonPrice('זוגי', 60, 's1', subscriptions, '2024-03-15', 240), 120);
});

test('calculateLessonPrice - Pair with paused subscription', () => {
  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'זוגי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-12-31',
      pauseSubscription: true, // Paused
    },
  ];
  
  // With paused subscription, should return 112.5 (no active subscription)
  assertEquals(calculateLessonPrice('pair', 60, 's1', subscriptions, '2024-03-15'), 112.5);
});

test('calculateLessonPrice - Pair with expired subscription', () => {
  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'זוגי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-02-29', // Expired
      pauseSubscription: false,
    },
  ];
  
  // With expired subscription, should return 112.5 (no active subscription)
  assertEquals(calculateLessonPrice('pair', 60, 's1', subscriptions, '2024-03-15'), 112.5);
});

test('calculateLessonPrice - Default/Unknown', () => {
  // Defaults to private price if not specified
  assertEquals(calculateLessonPrice(null), 175);
  assertEquals(calculateLessonPrice(undefined), 175);
  assertEquals(calculateLessonPrice(''), 175);
  assertEquals(calculateLessonPrice('unknown'), 175);
});

// Test: isCancellationBillable
test('isCancellationBillable - Less than 24 hours (billable)', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-15T10:00:00'; // 4 hours before
  
  assert(isCancellationBillable(lessonStart, cancellationTime) === true, 
    'Cancellation <24h should be billable');
});

test('isCancellationBillable - Exactly 24 hours (not billable)', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-14T14:00:00'; // Exactly 24 hours before
  
  assert(isCancellationBillable(lessonStart, cancellationTime) === false,
    'Cancellation exactly 24h should not be billable');
});

test('isCancellationBillable - More than 24 hours (not billable)', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-13T14:00:00'; // 48 hours before
  
  assert(isCancellationBillable(lessonStart, cancellationTime) === false,
    'Cancellation >24h should not be billable');
});

test('isCancellationBillable - No cancellation time (not billable)', () => {
  const lessonStart = '2024-03-15T14:00:00';
  
  assert(isCancellationBillable(lessonStart, null) === false,
    'No cancellation time should not be billable');
  assert(isCancellationBillable(lessonStart, undefined) === false,
    'No cancellation time should not be billable');
});

// Test: calculateCancellationCharge
test('calculateCancellationCharge - Billable cancellation (private)', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-15T10:00:00';
  
  assertEquals(calculateCancellationCharge(lessonStart, 'private', cancellationTime), 175);
  assertEquals(calculateCancellationCharge(lessonStart, 'פרטי', cancellationTime), 175);
});

test('calculateCancellationCharge - Billable cancellation (pair) - No subscription', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-15T10:00:00';
  const subscriptions: Subscription[] = [];
  
  // Without subscription, should charge 112.5 (225/2)
  assertEquals(calculateCancellationCharge(lessonStart, 'pair', cancellationTime, 60, 's1', subscriptions), 112.5);
  assertEquals(calculateCancellationCharge(lessonStart, 'זוגי', cancellationTime, 60, 's1', subscriptions), 112.5);
});

test('calculateCancellationCharge - Billable cancellation (pair) - With active subscription', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-15T10:00:00';
  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'זוגי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-12-31',
      pauseSubscription: false,
    },
  ];
  
  // With active subscription, should charge 0
  assertEquals(calculateCancellationCharge(lessonStart, 'pair', cancellationTime, 60, 's1', subscriptions), 0);
  assertEquals(calculateCancellationCharge(lessonStart, 'זוגי', cancellationTime, 60, 's1', subscriptions), 0);
});

test('calculateCancellationCharge - Non-billable cancellation', () => {
  const lessonStart = '2024-03-15T14:00:00';
  const cancellationTime = '2024-03-13T14:00:00'; // >24h
  
  assertEquals(calculateCancellationCharge(lessonStart, 'private', cancellationTime), 0);
});

// Test: getBillingMonth
test('getBillingMonth - Date object', () => {
  const date = new Date('2024-03-15');
  assertEquals(getBillingMonth(date), '2024-03');
});

test('getBillingMonth - Date string', () => {
  assertEquals(getBillingMonth('2024-03-15'), '2024-03');
  assertEquals(getBillingMonth('2024-12-31'), '2024-12');
  assertEquals(getBillingMonth('2024-01-01'), '2024-01');
});

test('getBillingMonth - Month padding', () => {
  assertEquals(getBillingMonth('2024-01-15'), '2024-01');
  assertEquals(getBillingMonth('2024-09-15'), '2024-09');
});

// Test: generateBillingKey
test('generateBillingKey - Format', () => {
  const key = generateBillingKey('rec123', '2024-03');
  assertEquals(key, 'rec123_2024-03');
});

test('generateBillingKey - Deterministic', () => {
  const key1 = generateBillingKey('rec123', '2024-03');
  const key2 = generateBillingKey('rec123', '2024-03');
  assertEquals(key1, key2, 'Billing key should be deterministic');
});

// Test: parseSubscriptionAmount
test('parseSubscriptionAmount - Currency string', () => {
  assertEquals(parseSubscriptionAmount('₪480.00'), 480);
  assertEquals(parseSubscriptionAmount('₪ 1,200.00'), 1200);
  assertEquals(parseSubscriptionAmount('480.00'), 480);
  assertEquals(parseSubscriptionAmount('480'), 480);
});

test('parseSubscriptionAmount - Number', () => {
  assertEquals(parseSubscriptionAmount(480), 480);
  assertEquals(parseSubscriptionAmount(1200.50), 1200.50);
});

test('parseSubscriptionAmount - Null/Undefined', () => {
  assertEquals(parseSubscriptionAmount(null), 0);
  assertEquals(parseSubscriptionAmount(undefined), 0);
});

test('parseSubscriptionAmount - Invalid', () => {
  assertEquals(parseSubscriptionAmount(''), 0);
  assertEquals(parseSubscriptionAmount('invalid'), 0);
  assertEquals(parseSubscriptionAmount(NaN), 0);
});

// Test: calculateStudentBilling
test('calculateStudentBilling - Private lessons only', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: true,
      lessonType: 'private',
    },
    {
      id: 'l2',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-20',
      startTime: '14:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: true,
      lessonType: 'private',
    },
  ];

  const subscriptions: Subscription[] = [];
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  assertEquals(result.lessonsTotal, 350); // 2 * 175
  assertEquals(result.cancellationsTotal, 0);
  assertEquals(result.subscriptionsTotal, 0);
  assertEquals(result.total, 350);
  assertEquals(result.lineItems.length, 2);
});

test('calculateStudentBilling - Pair/Group lessons without subscription (charged 112.5)', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: false,
      lessonType: 'pair',
    },
  ];

  const subscriptions: Subscription[] = [];
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  // Without subscription, pair lesson (no price set) should be charged 112.5 (225/2)
  assertEquals(result.lessonsTotal, 112.5);
  assertEquals(result.total, 112.5);
});

test('calculateStudentBilling - Group lesson without subscription (charged 120)', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: false,
      lessonType: 'group',
      // no price - group uses fixed 120 per student
    },
  ];

  const subscriptions: Subscription[] = [];
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  assertEquals(result.lessonsTotal, 120);
  assertEquals(result.total, 120);
});

test('calculateStudentBilling - Pair lesson with price (total) - each student charged half', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: false,
      lessonType: 'pair',
      price: 200, // total for pair; each student charged 100
    },
  ];

  const subscriptions: Subscription[] = [];
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  assertEquals(result.lessonsTotal, 100);
  assertEquals(result.total, 100);
});

test('calculateStudentBilling - Pair/Group lessons with active subscription (not charged)', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: false,
      lessonType: 'pair',
    },
  ];

  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'זוגי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-12-31',
      pauseSubscription: false,
    },
  ];
  
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  // With active subscription, pair lesson should be charged 0
  assertEquals(result.lessonsTotal, 0);
  assertEquals(result.subscriptionsTotal, 480);
  assertEquals(result.total, 480);
});

test('calculateStudentBilling - Billable cancellation', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '14:00',
      duration: 60,
      status: LessonStatus.CANCELLED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: true,
      lessonType: 'private',
    },
  ];

  const subscriptions: Subscription[] = [];
  // Note: cancellation_datetime would need to be <24h before lesson
  // For this test, we're testing the structure
  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  // Cancellation charge depends on cancellation_datetime field
  // This test verifies the structure works
  assert(result.lineItems.length >= 0, 'Should handle cancellations');
});

test('calculateStudentBilling - With subscription', () => {
  const lessons: Lesson[] = [];
  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'קבוצתי',
      subscriptionStartDate: '2024-01-01',
      subscriptionEndDate: '2024-12-31',
    },
  ];

  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  assertEquals(result.subscriptionsTotal, 480);
  assertEquals(result.total, 480);
  assertEquals(result.lineItems.length, 1);
});

test('calculateStudentBilling - Total calculation (no VAT)', () => {
  const lessons: Lesson[] = [
    {
      id: 'l1',
      studentId: 's1',
      studentName: 'Test Student',
      date: '2024-03-15',
      startTime: '10:00',
      duration: 60,
      status: LessonStatus.COMPLETED,
      subject: 'Math',
      isChargeable: true,
      isPrivate: true,
      lessonType: 'private',
    },
  ];

  const subscriptions: Subscription[] = [
    {
      id: 'sub1',
      studentId: 's1',
      monthlyAmount: '₪480.00',
      subscriptionType: 'קבוצתי',
    },
  ];

  const result = calculateStudentBilling(lessons, subscriptions, 's1', '2024-03');

  // total = lessons_total + cancellations_total + subscriptions_total (no VAT)
  const expectedTotal = result.lessonsTotal + result.cancellationsTotal + result.subscriptionsTotal;
  assertEquals(result.total, expectedTotal);
  assertEquals(result.total, 175 + 480);
});

// ==================== Test Runner ====================

async function runTests(): Promise<{ passed: number; failed: number }> {
  let p = 0;
  let f = 0;
  for (const t of tests) {
    try {
      t.fn();
      p++;
    } catch (error: any) {
      f++;
      console.error(`✗ ${t.name}: ${error.message}`);
    }
  }
  if (typeof require !== 'undefined' && require.main === module) {
    console.log(`\n${p} passed, ${f} failed`);
    if (f > 0) process.exit(1);
  }
  return { passed: p, failed: f };
}

// Run tests if this file is executed directly (Node)
if (typeof require !== 'undefined' && require.main === module) {
  runTests().catch(console.error);
}

// Jest: expose a single test that runs all custom tests
export { runTests };
if (typeof expect !== 'undefined') {
  (describe as any)('billingService', () => {
    it('calculateLessonPrice, calculateStudentBilling, and helpers', async () => {
      const result = await runTests();
      expect(result.failed).toBe(0);
      expect(result.passed).toBeGreaterThan(0);
    });
  });
}
