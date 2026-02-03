/**
 * Jest Unit Tests for billingRules.ts
 * 
 * Tests pure functions only (no Airtable calls)
 */

import {
  calculateLessonsContribution,
  calculateCancellationsContribution,
  calculateSubscriptionsContribution,
  calculateTotal,
  determineBillingStatus,
  isLessonExcluded,
  isPrivateLesson,
  calculateLessonAmount,
  isSubscriptionActiveForMonth,
  parseMonthlyAmount,
  hasMultipleStudents,
  getAllStudentIds,
} from './billingRules';
import {
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
} from '../contracts/types';
import { MissingFieldsError } from './domainErrors';

describe('billingRules', () => {
  const billingMonth = '2024-03';
  const studentId = 'recStudent123';

  describe('calculateLessonsContribution', () => {
    test('Scenario 1: Student with 4 private lessons => lessons_total = 700, total = 700', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'מתוכנן',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-10',
          start_datetime: '2024-03-10T14:00:00Z',
          end_datetime: '2024-03-10T15:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L003',
          full_name: studentId,
          status: 'מתוכנן',
          lesson_date: '2024-03-15',
          start_datetime: '2024-03-15T16:00:00Z',
          end_datetime: '2024-03-15T17:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L004',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-20',
          start_datetime: '2024-03-20T10:00:00Z',
          end_datetime: '2024-03-20T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(700); // 4 × 175
        expect(result.lessonsCount).toBe(4);
      }
    });

    test('Scenario 2: Student with 2 pair lessons and NO subscription => lessons_total = 240', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'זוגי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-10',
          start_datetime: '2024-03-10T14:00:00Z',
          end_datetime: '2024-03-10T15:00:00Z',
          lesson_type: 'זוגי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const subscriptions: SubscriptionsAirtableFields[] = [];
      const result = calculateLessonsContribution(lessons, billingMonth, studentId, subscriptions);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(240); // 2 × 120 (pair lessons without subscription)
        expect(result.lessonsCount).toBe(2);
      }
    });

    test('Group lessons never add per-lesson charges (0), subscription only', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'קבוצתי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-10',
          start_datetime: '2024-03-10T14:00:00Z',
          end_datetime: '2024-03-10T15:00:00Z',
          lesson_type: 'קבוצתי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(0);
        expect(result.lessonsCount).toBe(0);
      }
    });

    test('Excludes cancelled lessons', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'בוטל',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: studentId,
          status: 'בוטל ע"י מנהל',
          lesson_date: '2024-03-10',
          start_datetime: '2024-03-10T14:00:00Z',
          end_datetime: '2024-03-10T15:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L003',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-15',
          start_datetime: '2024-03-15T16:00:00Z',
          end_datetime: '2024-03-15T17:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(175); // Only 1 lesson included
        expect(result.lessonsCount).toBe(1);
      }
    });

    test('Only includes lessons for target student', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: 'recOtherStudent',
          status: 'הסתיים',
          lesson_date: '2024-03-10',
          start_datetime: '2024-03-10T14:00:00Z',
          end_datetime: '2024-03-10T15:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(175); // Only 1 lesson for this student
        expect(result.lessonsCount).toBe(1);
      }
    });

    test('Multi-student private lesson returns MISSING_FIELDS', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: [studentId, 'recOtherStudent'], // Multi-link
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).toBeInstanceOf(MissingFieldsError);
      if (result instanceof MissingFieldsError) {
        expect(result.missingFields.length).toBeGreaterThan(0);
        expect(result.missingFields[0].table).toBe('lessons');
        expect(result.missingFields[0].field).toContain('multi-link');
      }
    });

    test('Multi-student pair/group lesson without subscription contributes 120', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: [studentId, 'recOtherStudent'], // Multi-link
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'זוגי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const subscriptions: SubscriptionsAirtableFields[] = [];
      const result = calculateLessonsContribution(lessons, billingMonth, studentId, subscriptions);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        // Without subscription, should charge 120 (checked for primary student)
        expect(result.lessonsTotal).toBe(120);
        expect(result.lessonsCount).toBe(1);
      }
    });

    test('Multi-student pair/group lesson with active subscription contributes 0', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: [studentId, 'recOtherStudent'], // Multi-link
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'זוגי',
          duration: 60,
          billing_month: billingMonth,
        },
      ];

      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-12-31',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];
      
      const result = calculateLessonsContribution(lessons, billingMonth, studentId, subscriptions);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        // With active subscription, should charge 0
        expect(result.lessonsTotal).toBe(0);
        expect(result.lessonsCount).toBe(0);
      }
    });

    test('Uses line_amount if present', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
          line_amount: 200, // Custom amount
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(200); // Uses line_amount, not default 175
        expect(result.lessonsCount).toBe(1);
      }
    });

    test('Only includes lessons with matching billing_month', () => {
      const lessons: LessonsAirtableFields[] = [
        {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        },
        {
          lesson_id: 'L002',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-04-05',
          start_datetime: '2024-04-05T10:00:00Z',
          end_datetime: '2024-04-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: '2024-04', // Different month
        },
      ];

      const result = calculateLessonsContribution(lessons, billingMonth, studentId);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.lessonsTotal).toBe(175); // Only 1 lesson in March
        expect(result.lessonsCount).toBe(1);
      }
    });
  });

  describe('calculateCancellationsContribution', () => {
    test('Scenario 4: Cancellation >=24h => cancellation not billable => total unaffected', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 48, // >=24h
          is_lt_24h: 0, // Not <24h
          is_charged: false,
          charge: 0,
          billing_month: billingMonth,
        },
      ];

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        undefined // No linked lesson needed
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(0);
        expect(result.cancellationsCount).toBe(0);
        expect(result.pendingCancellationsCount).toBe(0);
      }
    });

    test('Scenario 5: <24h cancellation with is_charged=false => pending_approval, not included in total', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12, // <24h
          is_lt_24h: 1,
          is_charged: false, // Not charged yet
          charge: 0,
          billing_month: billingMonth,
        },
      ];

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        undefined
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(0); // Not included
        expect(result.cancellationsCount).toBe(0);
        expect(result.pendingCancellationsCount).toBe(1); // Pending approval
      }
    });

    test('Scenario 6: <24h cancellation with is_charged=true and charge=175 => included', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12, // <24h
          is_lt_24h: 1,
          is_charged: true,
          charge: 175, // Explicit charge
          billing_month: billingMonth,
        },
      ];

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        undefined
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(175);
        expect(result.cancellationsCount).toBe(1);
        expect(result.pendingCancellationsCount).toBe(0);
      }
    });

    test('Cancellation with linked private lesson => charge 175 if charge not set', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: undefined, // Not set
          billing_month: billingMonth,
        },
      ];

      const linkedLesson: LessonsAirtableFields = {
        lesson_id: 'L001',
        full_name: studentId,
        status: 'בוטל',
        lesson_date: '2024-03-10',
        start_datetime: '2024-03-10T10:00:00Z',
        end_datetime: '2024-03-10T11:00:00Z',
        lesson_type: 'פרטי',
        duration: 60,
        billing_month: billingMonth,
      };

      const getLinkedLesson = (lessonId: string) => {
        if (lessonId === 'recLesson123') return linkedLesson;
        return undefined;
      };

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        getLinkedLesson
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(175); // From linked lesson type
        expect(result.cancellationsCount).toBe(1);
      }
    });

    test('Cancellation with linked pair/group lesson => charge 0', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: undefined,
          billing_month: billingMonth,
        },
      ];

      const linkedLesson: LessonsAirtableFields = {
        lesson_id: 'L001',
        full_name: studentId,
        status: 'בוטל',
        lesson_date: '2024-03-10',
        start_datetime: '2024-03-10T10:00:00Z',
        end_datetime: '2024-03-10T11:00:00Z',
        lesson_type: 'זוגי',
        duration: 60,
        billing_month: billingMonth,
      };

      const getLinkedLesson = (lessonId: string) => {
        if (lessonId === 'recLesson123') return linkedLesson;
        return undefined;
      };

      const subscriptions: SubscriptionsAirtableFields[] = [];
      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        getLinkedLesson,
        subscriptions
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(120); // Pair/group without subscription = 120
        expect(result.cancellationsCount).toBe(1);
      }
    });

    test('Cancellation with linked pair/group lesson with active subscription => charge 0', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: undefined,
          billing_month: billingMonth,
        },
      ];

      const linkedLesson: LessonsAirtableFields = {
        lesson_id: 'L001',
        full_name: studentId,
        status: 'בוטל',
        lesson_date: '2024-03-10',
        start_datetime: '2024-03-10T10:00:00Z',
        end_datetime: '2024-03-10T11:00:00Z',
        lesson_type: 'זוגי',
        duration: 60,
        billing_month: billingMonth,
      };

      const getLinkedLesson = (lessonId: string) => {
        if (lessonId === 'recLesson123') return linkedLesson;
        return undefined;
      };

      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-12-31',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];
      
      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        getLinkedLesson,
        subscriptions
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(0); // Pair/group with active subscription = 0
        expect(result.cancellationsCount).toBe(1);
      }
    });

    test('Cancellation without charge and without linked lesson => MISSING_FIELDS', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: undefined, // Not set
          billing_month: billingMonth,
        },
      ];

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        undefined // No linked lesson
      );

      expect(result).toBeInstanceOf(MissingFieldsError);
      if (result instanceof MissingFieldsError) {
        expect(result.missingFields.length).toBeGreaterThan(0);
        expect(result.missingFields[0].table).toBe('cancellations');
      }
    });

    test('Only includes cancellations with matching billing_month', () => {
      const cancellations: CancellationsAirtableFields[] = [
        {
          natural_key: 'CANCEL001',
          lesson: 'recLesson123',
          student: studentId,
          cancellation_date: '2024-03-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: 175,
          billing_month: billingMonth,
        },
        {
          natural_key: 'CANCEL002',
          lesson: 'recLesson456',
          student: studentId,
          cancellation_date: '2024-04-10',
          hours_before: 12,
          is_lt_24h: 1,
          is_charged: true,
          charge: 175,
          billing_month: '2024-04', // Different month
        },
      ];

      const result = calculateCancellationsContribution(
        cancellations,
        billingMonth,
        undefined
      );

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.cancellationsTotal).toBe(175); // Only 1 in March
        expect(result.cancellationsCount).toBe(1);
      }
    });
  });

  describe('calculateSubscriptionsContribution', () => {
    test('Scenario 3: Student with 2 pair lessons and active subscription monthly_amount=300 => total = 300', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-12-31',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(300);
        expect(result.activeSubscriptionsCount).toBe(1);
      }
    });

    test('Paused subscription not included', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-12-31',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: true, // Paused
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(0);
        expect(result.activeSubscriptionsCount).toBe(0);
      }
    });

    test('Subscription starting after billing month not included', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-04-01', // Starts after March
          subscription_end_date: '2024-12-31',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(0);
        expect(result.activeSubscriptionsCount).toBe(0);
      }
    });

    test('Subscription ending before billing month not included', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-02-29', // Ends before March
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(0);
        expect(result.activeSubscriptionsCount).toBe(0);
      }
    });

    test('Subscription without end_date active indefinitely', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: undefined, // No end date
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(300);
        expect(result.activeSubscriptionsCount).toBe(1);
      }
    });

    test('Overlapping subscriptions return MISSING_FIELDS', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-06-30',
          monthly_amount: 300,
          subscription_type: 'pair',
          pause_subscription: false,
        },
        {
          id: 'SUB002',
          student_id: studentId,
          subscription_start_date: '2024-03-01', // Overlaps with SUB001
          subscription_end_date: '2024-12-31',
          monthly_amount: 400,
          subscription_type: 'group',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).toBeInstanceOf(MissingFieldsError);
      if (result instanceof MissingFieldsError) {
        expect(result.missingFields.length).toBeGreaterThan(0);
        expect(result.missingFields[0].table).toBe('Subscriptions');
        expect(result.missingFields[0].field).toContain('business_rule');
      }
    });

    test('Parses currency string monthly_amount', () => {
      const subscriptions: SubscriptionsAirtableFields[] = [
        {
          id: 'SUB001',
          student_id: studentId,
          subscription_start_date: '2024-01-01',
          subscription_end_date: '2024-12-31',
          monthly_amount: '₪480.00', // Currency string
          subscription_type: 'pair',
          pause_subscription: false,
        },
      ];

      const result = calculateSubscriptionsContribution(subscriptions, billingMonth);

      expect(result).not.toBeInstanceOf(MissingFieldsError);
      if (!(result instanceof MissingFieldsError)) {
        expect(result.subscriptionsTotal).toBe(480);
      }
    });
  });

  describe('calculateTotal', () => {
    test('Total = lessons + cancellations + subscriptions (no VAT)', () => {
      const lessonsTotal = 700;
      const cancellationsTotal = 175;
      const subscriptionsTotal = 300;

      const total = calculateTotal(lessonsTotal, cancellationsTotal, subscriptionsTotal);

      expect(total).toBe(1175); // 700 + 175 + 300
    });

    test('Total with zero components', () => {
      expect(calculateTotal(0, 0, 0)).toBe(0);
      expect(calculateTotal(100, 0, 0)).toBe(100);
      expect(calculateTotal(0, 50, 0)).toBe(50);
      expect(calculateTotal(0, 0, 200)).toBe(200);
    });
  });

  describe('determineBillingStatus', () => {
    test('Status is paid if isPaid is true', () => {
      expect(determineBillingStatus(0, true)).toBe('paid');
      expect(determineBillingStatus(5, true)).toBe('paid'); // Even with pending cancellations
    });

    test('Status is pending_approval if pendingCancellationsCount > 0', () => {
      expect(determineBillingStatus(1, false)).toBe('pending_approval');
      expect(determineBillingStatus(3, false)).toBe('pending_approval');
    });

    test('Status is approved if no pending cancellations and not paid', () => {
      expect(determineBillingStatus(0, false)).toBe('approved');
    });
  });

  describe('isSubscriptionActiveForMonth - Timezone boundaries (Asia/Jerusalem)', () => {
    // Test month boundaries with Asia/Jerusalem timezone considerations
    // Note: Current implementation uses local dates, but tests verify logic
    // For production, use a timezone library for proper DST handling

    test('Subscription active at start of month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-03-01', // First day of month
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription active at end of month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-03-31', // Last day of month
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription spanning entire month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription starting mid-month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-03-15', // Mid-month
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription ending mid-month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-03-15', // Mid-month
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription not active - starts after month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-04-01', // After March
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(false);
    });

    test('Subscription not active - ends before month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-02-29', // Before March
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(false);
    });

    test('Subscription boundary: starts exactly on first day of month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-03-01', // First day
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription boundary: ends exactly on last day of month', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-03-31', // Last day of March
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(true);
    });

    test('Subscription boundary: starts day after month ends', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-04-01', // Day after March ends
        subscription_end_date: '2024-12-31',
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(false);
    });

    test('Subscription boundary: ends day before month starts', () => {
      const subscription: SubscriptionsAirtableFields = {
        id: 'SUB001',
        student_id: studentId,
        subscription_start_date: '2024-01-01',
        subscription_end_date: '2024-02-29', // Day before March starts
        monthly_amount: 300,
        subscription_type: 'pair',
        pause_subscription: false,
      };

      expect(isSubscriptionActiveForMonth(subscription, '2024-03')).toBe(false);
    });
  });

  describe('Helper functions', () => {
    test('isLessonExcluded', () => {
      expect(isLessonExcluded('בוטל')).toBe(true);
      expect(isLessonExcluded('בוטל ע"י מנהל')).toBe(true);
      expect(isLessonExcluded('הסתיים')).toBe(false);
      expect(isLessonExcluded('מתוכנן')).toBe(false);
    });

    test('isPrivateLesson', () => {
      expect(isPrivateLesson('פרטי')).toBe(true);
      expect(isPrivateLesson('זוגי')).toBe(false);
      expect(isPrivateLesson('קבוצתי')).toBe(false);
    });

    test('calculateLessonAmount', () => {
      const lessonWithLineAmount: LessonsAirtableFields = {
        lesson_id: 'L001',
        full_name: studentId,
        status: 'הסתיים',
        lesson_date: '2024-03-05',
        start_datetime: '2024-03-05T10:00:00Z',
        end_datetime: '2024-03-05T11:00:00Z',
        lesson_type: 'פרטי',
        duration: 60,
        billing_month: billingMonth,
        line_amount: 200,
      };

      expect(calculateLessonAmount(lessonWithLineAmount)).toBe(200);

      const lessonWithoutLineAmount: LessonsAirtableFields = {
        lesson_id: 'L002',
        full_name: studentId,
        status: 'הסתיים',
        lesson_date: '2024-03-05',
        start_datetime: '2024-03-05T10:00:00Z',
        end_datetime: '2024-03-05T11:00:00Z',
        lesson_type: 'פרטי',
        duration: 60,
        billing_month: billingMonth,
      };

      expect(calculateLessonAmount(lessonWithoutLineAmount)).toBe(175);
    });

    test('parseMonthlyAmount', () => {
      expect(parseMonthlyAmount(300)).toBe(300);
      expect(parseMonthlyAmount('300')).toBe(300);
      expect(parseMonthlyAmount('₪300.00')).toBe(300);
      expect(parseMonthlyAmount('₪ 1,200.00')).toBe(1200);
      expect(parseMonthlyAmount('')).toBe(0);
      expect(parseMonthlyAmount('invalid')).toBe(0);
    });

    test('hasMultipleStudents', () => {
      expect(hasMultipleStudents('rec123')).toBe(false);
      expect(hasMultipleStudents(['rec123'])).toBe(false);
      expect(hasMultipleStudents(['rec123', 'rec456'])).toBe(true);
    });

    test('getAllStudentIds', () => {
      expect(getAllStudentIds('rec123')).toEqual(['rec123']);
      expect(getAllStudentIds(['rec123'])).toEqual(['rec123']);
      expect(getAllStudentIds(['rec123', 'rec456'])).toEqual(['rec123', 'rec456']);
    });
  });
});
