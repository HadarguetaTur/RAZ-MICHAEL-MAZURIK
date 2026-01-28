/**
 * Domain Errors for Billing Engine
 */

export class DomainError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class MissingFieldsError extends DomainError {
  constructor(public missingFields: Array<{
    table: string;
    field: string;
    why_needed: string;
    example_values: string[];
  }>) {
    super(
      'Required Airtable fields are missing',
      'MISSING_FIELDS',
      { MISSING_FIELDS: missingFields }
    );
    this.name = 'MissingFieldsError';
  }
}

export class DuplicateBillingRecordsError extends DomainError {
  constructor(
    public studentRecordId: string,
    public billingMonth: string,
    public recordIds: string[]
  ) {
    super(
      `Multiple billing records found for student ${studentRecordId} and month ${billingMonth}`,
      'DUPLICATE_BILLING_RECORDS',
      {
        studentRecordId,
        billingMonth,
        recordIds,
        count: recordIds.length,
      }
    );
    this.name = 'DuplicateBillingRecordsError';
  }
}

export class AirtableError extends DomainError {
  constructor(
    message: string,
    public status?: number,
    public airtableDetails?: any
  ) {
    super(message, 'AIRTABLE_ERROR', { status, airtableDetails });
    this.name = 'AirtableError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR', { field });
    this.name = 'ValidationError';
  }
}
