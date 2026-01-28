/**
 * Jest Unit Tests for billingEngine.ts
 * 
 * Tests orchestration logic (with mocked AirtableClient)
 */

import { AirtableClient } from './airtableClient';
import { buildStudentMonth } from './billingEngine';
import { DuplicateBillingRecordsError } from './domainErrors';
import {
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
  BillingAirtableFields,
  StudentsAirtableFields,
} from '../contracts/types';

// Mock AirtableClient
jest.mock('./airtableClient');

describe('billingEngine', () => {
  let mockClient: jest.Mocked<AirtableClient>;
  const studentId = 'recStudent123';
  const billingMonth = '2024-03';

  beforeEach(() => {
    mockClient = {
      getTableId: jest.fn((tableName: string) => {
        const tableMap: Record<string, string> = {
          students: 'tblStudents',
          lessons: 'tblLessons',
          cancellations: 'tblCancellations',
          subscriptions: 'tblSubscriptions',
          monthlyBills: 'tblBilling',
        };
        return tableMap[tableName] || tableName;
      }),
      getRecord: jest.fn(),
      listRecords: jest.fn(),
      createRecord: jest.fn(),
      updateRecord: jest.fn(),
      findRecordsByField: jest.fn(),
    } as any;
  });

  test('Scenario 8: Duplicate Billing records => DUPLICATE_BILLING_RECORDS thrown', async () => {
    // Mock student
    mockClient.getRecord.mockResolvedValueOnce({
      id: studentId,
      fields: {
        full_name: 'Test Student',
        phone_number: '050-1234567',
        is_active: true,
      } as StudentsAirtableFields,
    });

    // Mock lessons (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock cancellations (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock subscriptions (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock finding duplicate billing records
    mockClient.listRecords.mockResolvedValueOnce([
      {
        id: 'recBill1',
        fields: {
          id: 'bill1',
          'חודש חיוב': billingMonth,
          'שולם': false,
          'מאושר לחיוב': false,
          'תלמיד': studentId,
        } as BillingAirtableFields,
      },
      {
        id: 'recBill2',
        fields: {
          id: 'bill2',
          'חודש חיוב': billingMonth,
          'שולם': false,
          'מאושר לחיוב': false,
          'תלמיד': studentId,
        } as BillingAirtableFields,
      },
    ]);

    await expect(
      buildStudentMonth(mockClient, studentId, billingMonth)
    ).rejects.toThrow(DuplicateBillingRecordsError);

    await expect(
      buildStudentMonth(mockClient, studentId, billingMonth)
    ).rejects.toThrow('Multiple billing records found');

    // Verify it didn't try to create or update
    expect(mockClient.createRecord).not.toHaveBeenCalled();
    expect(mockClient.updateRecord).not.toHaveBeenCalled();
  });

  test('Single billing record - updates existing', async () => {
    // Mock student
    mockClient.getRecord.mockResolvedValueOnce({
      id: studentId,
      fields: {
        full_name: 'Test Student',
        phone_number: '050-1234567',
        is_active: true,
      } as StudentsAirtableFields,
    });

    // Mock lessons
    mockClient.listRecords.mockResolvedValueOnce([
      {
        id: 'recLesson1',
        fields: {
          lesson_id: 'L001',
          full_name: studentId,
          status: 'הסתיים',
          lesson_date: '2024-03-05',
          start_datetime: '2024-03-05T10:00:00Z',
          end_datetime: '2024-03-05T11:00:00Z',
          lesson_type: 'פרטי',
          duration: 60,
          billing_month: billingMonth,
        } as LessonsAirtableFields,
      },
    ]);

    // Mock cancellations (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock subscriptions (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock finding single billing record
    mockClient.listRecords.mockResolvedValueOnce([
      {
        id: 'recBill1',
        fields: {
          id: 'bill1',
          'חודש חיוב': billingMonth,
          'שולם': false,
          'מאושר לחיוב': false,
          'תלמיד': studentId,
        } as BillingAirtableFields,
      },
    ]);

    // Mock update
    mockClient.updateRecord.mockResolvedValueOnce({
      id: 'recBill1',
      fields: {
        id: 'bill1',
        'חודש חיוב': billingMonth,
        'שולם': false,
        'מאושר לחיוב': true,
        'תלמיד': studentId,
      } as BillingAirtableFields,
    });

    const result = await buildStudentMonth(mockClient, studentId, billingMonth);

    expect(result).not.toBeInstanceOf(Error);
    if (result && typeof result === 'object' && 'created' in result) {
      expect(result.created).toBe(false); // Updated, not created
      expect(result.lessonsTotal).toBe(175);
      expect(mockClient.updateRecord).toHaveBeenCalled();
      expect(mockClient.createRecord).not.toHaveBeenCalled();
    }
  });

  test('No billing record - creates new', async () => {
    // Mock student
    mockClient.getRecord.mockResolvedValueOnce({
      id: studentId,
      fields: {
        full_name: 'Test Student',
        phone_number: '050-1234567',
        is_active: true,
      } as StudentsAirtableFields,
    });

    // Mock lessons (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock cancellations (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock subscriptions (empty)
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock finding no billing records
    mockClient.listRecords.mockResolvedValueOnce([]);

    // Mock create
    mockClient.createRecord.mockResolvedValueOnce({
      id: 'recBillNew',
      fields: {
        id: 'billNew',
        'חודש חיוב': billingMonth,
        'שולם': false,
        'מאושר לחיוב': true,
        'תלמיד': studentId,
      } as BillingAirtableFields,
    });

    const result = await buildStudentMonth(mockClient, studentId, billingMonth);

    expect(result).not.toBeInstanceOf(Error);
    if (result && typeof result === 'object' && 'created' in result) {
      expect(result.created).toBe(true); // Created
      expect(mockClient.createRecord).toHaveBeenCalled();
      expect(mockClient.updateRecord).not.toHaveBeenCalled();
    }
  });
});
