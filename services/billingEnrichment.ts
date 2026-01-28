/**
 * Billing Enrichment Service
 * 
 * Enriches MonthlyBill rows with additional data:
 * - subscriptionType, subscriptionPrice (from active subscriptions or student fallback)
 * - cancellationsCountMonthly, lateCancellationsCountMonthly (from cancellations table)
 * 
 * IMPORTANT: Does NOT modify totalAmount - that remains unchanged from the original report.
 */

import { AirtableClient } from './airtableClient';
import { MonthlyBill } from '../types';
import { TABLES, FIELDS } from '../contracts/fieldMap';

/**
 * Extract student record ID from linked record field
 */
function extractStudentRecordId(studentField: any): string | null {
  if (!studentField) return null;
  if (typeof studentField === 'string') return studentField;
  if (Array.isArray(studentField) && studentField.length > 0) {
    return typeof studentField[0] === 'string' ? studentField[0] : studentField[0]?.id || null;
  }
  return null;
}

/**
 * Parse subscription monthly amount (handles currency strings like "₪480.00")
 */
function parseMonthlyAmount(amount: string | number | undefined | null): number {
  if (typeof amount === 'number') return amount;
  if (!amount) return 0;
  const str = String(amount);
  // Remove currency symbols and whitespace, then parse
  const cleaned = str.replace(/[₪,\s]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Check if subscription overlaps with billing month
 */
function subscriptionOverlapsMonth(
  startDate: string | undefined,
  endDate: string | undefined,
  monthStart: Date,
  monthEnd: Date
): boolean {
  if (!startDate) return false;
  
  const subStart = new Date(startDate);
  const subEnd = endDate ? new Date(endDate) : null;
  
  // Subscription must start before or on month end
  if (subStart > monthEnd) return false;
  
  // Subscription must not end before month start (or have no end date)
  if (subEnd && subEnd < monthStart) return false;
  
  return true;
}

/**
 * Enrich billing rows with subscription and cancellation data
 */
export async function enrichBillingRows(
  rows: MonthlyBill[],
  monthKey: string,
  client: AirtableClient
): Promise<MonthlyBill[]> {
  if (rows.length === 0) {
    return rows;
  }

  // Calculate month date range
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // Collect all student record IDs
  const studentRecordIds = new Set<string>();
  rows.forEach(row => {
    if (row.studentId) {
      studentRecordIds.add(row.studentId);
    }
  });

  if (studentRecordIds.size === 0) {
    return rows;
  }

  // Step 1: Fetch cancellations for the month
  const cancellationsTableId = TABLES.cancellations.id;
  const cancellationsFilter = `{${FIELDS.cancellations.billing_month}} = "${monthKey}"`;
  
  let cancellationsData: Array<{ id: string; fields: any }> = [];
  try {
    cancellationsData = await client.getRecords(cancellationsTableId, {
      filterByFormula: cancellationsFilter,
      maxRecords: 10000,
    });
  } catch (error: any) {
    console.warn('[billingEnrichment] Failed to fetch cancellations:', error);
    // Continue without cancellations data
  }

  // Group cancellations by student
  const cancellationsByStudent = new Map<string, { total: number; late: number }>();
  cancellationsData.forEach(record => {
    const fields = record.fields;
    const studentId = extractStudentRecordId(fields[FIELDS.cancellations.student]);
    if (!studentId || !studentRecordIds.has(studentId)) return;

    const isLate = fields[FIELDS.cancellations.is_lt_24h] === 1 || fields[FIELDS.cancellations.is_lt_24h] === '1';
    
    if (!cancellationsByStudent.has(studentId)) {
      cancellationsByStudent.set(studentId, { total: 0, late: 0 });
    }
    const counts = cancellationsByStudent.get(studentId)!;
    counts.total += 1;
    if (isLate) {
      counts.late += 1;
    }
  });

  // Step 2: Fetch all subscriptions (no filter - we'll filter in code)
  const subscriptionsTableId = TABLES.subscriptions.id;
  let subscriptionsData: Array<{ id: string; fields: any }> = [];
  try {
    subscriptionsData = await client.getRecords(subscriptionsTableId, {
      maxRecords: 10000,
    });
  } catch (error: any) {
    console.warn('[billingEnrichment] Failed to fetch subscriptions:', error);
    // Continue without subscriptions data
  }

  // Filter subscriptions by overlap and group by student
  // If multiple active subscriptions exist, take the one with latest start_date
  const subscriptionsByStudent = new Map<string, {
    type: string;
    price: number;
    startDate: string;
  }>();

  subscriptionsData.forEach(record => {
    const fields = record.fields;
    const studentId = extractStudentRecordId(fields[FIELDS.subscriptions.student_id]);
    if (!studentId || !studentRecordIds.has(studentId)) return;

    // Check if paused
    const isPaused = fields[FIELDS.subscriptions.pause_subscription] === true || 
                     fields[FIELDS.subscriptions.pause_subscription] === 1;
    if (isPaused) return;

    // Check overlap with month
    const startDate = fields[FIELDS.subscriptions.subscription_start_date];
    const endDate = fields[FIELDS.subscriptions.subscription_end_date];
    
    if (!subscriptionOverlapsMonth(startDate, endDate, monthStart, monthEnd)) {
      return;
    }

    const subscriptionType = fields[FIELDS.subscriptions.subscription_type] || '';
    const monthlyAmount = parseMonthlyAmount(fields[FIELDS.subscriptions.monthly_amount]);

    // If student already has a subscription, keep the one with latest start_date
    const existing = subscriptionsByStudent.get(studentId);
    if (existing) {
      const existingStartDate = new Date(existing.startDate);
      const newStartDate = new Date(startDate);
      if (newStartDate > existingStartDate) {
        subscriptionsByStudent.set(studentId, {
          type: subscriptionType,
          price: monthlyAmount,
          startDate: startDate,
        });
      }
    } else {
      subscriptionsByStudent.set(studentId, {
        type: subscriptionType,
        price: monthlyAmount,
        startDate: startDate,
      });
    }
  });

  // Step 3: Fallback - fetch student data for those without active subscriptions
  const studentsNeedingFallback = Array.from(studentRecordIds).filter(
    id => !subscriptionsByStudent.has(id)
  );

  const studentsFallback = new Map<string, {
    type: string;
    price: number;
  }>();

  if (studentsNeedingFallback.length > 0) {
    const studentsTableId = TABLES.students.id;
    try {
      // Fetch students in batches (Airtable has limits)
      const batchSize = 100;
      for (let i = 0; i < studentsNeedingFallback.length; i += batchSize) {
        const batch = studentsNeedingFallback.slice(i, i + batchSize);
        // Build filter formula: OR({RECORD_ID()} = "rec1", {RECORD_ID()} = "rec2", ...)
        const recordIdFilters = batch.map(id => `RECORD_ID() = "${id}"`).join(', ');
        const filterFormula = `OR(${recordIdFilters})`;
        
        const studentRecords = await client.getRecords(studentsTableId, {
          filterByFormula: filterFormula,
          maxRecords: batchSize,
        });

        studentRecords.forEach(record => {
          const fields = record.fields;
          const studentId = record.id;
          
          // Get subscription price from formula field
          const subscriptionPrice = parseMonthlyAmount(
            fields[FIELDS.students.Subscription_Monthly_Amount]
          );

          // Determine subscription type from checkboxes
          const isBaketa = fields[FIELDS.students['מנוי_בקתה']] === true || 
                          fields[FIELDS.students['מנוי_בקתה']] === 1;
          const isGroup = fields[FIELDS.students['מנוי_קבוצתי']] === true || 
                         fields[FIELDS.students['מנוי_קבוצתי']] === 1;

          let subscriptionType = '—';
          if (isBaketa) {
            subscriptionType = 'בקתה';
          } else if (isGroup) {
            subscriptionType = 'קבוצתי';
          }

          studentsFallback.set(studentId, {
            type: subscriptionType,
            price: subscriptionPrice,
          });
        });
      }
    } catch (error: any) {
      console.warn('[billingEnrichment] Failed to fetch student fallback data:', error);
      // Continue without fallback data
    }
  }

  // Step 4: Enrich rows
  return rows.map(row => {
    const studentId = row.studentId;
    const enriched: MonthlyBill = { ...row };

    // Add cancellation counts
    const cancellationCounts = cancellationsByStudent.get(studentId);
    if (cancellationCounts) {
      enriched.cancellationsCountMonthly = cancellationCounts.total;
      enriched.lateCancellationsCountMonthly = cancellationCounts.late;
    } else {
      enriched.cancellationsCountMonthly = 0;
      enriched.lateCancellationsCountMonthly = 0;
    }

    // Add subscription data (prefer active subscription, fallback to student)
    const activeSubscription = subscriptionsByStudent.get(studentId);
    if (activeSubscription) {
      enriched.subscriptionType = activeSubscription.type || '—';
      enriched.subscriptionPrice = activeSubscription.price || undefined;
    } else {
      const fallback = studentsFallback.get(studentId);
      if (fallback) {
        enriched.subscriptionType = fallback.type;
        enriched.subscriptionPrice = fallback.price > 0 ? fallback.price : undefined;
      } else {
        enriched.subscriptionType = '—';
        enriched.subscriptionPrice = undefined;
      }
    }

    return enriched;
  });
}
