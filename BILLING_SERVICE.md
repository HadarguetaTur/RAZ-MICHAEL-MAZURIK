# Monthly Billing Service

This service implements monthly billing logic for the Airtable-based tutoring system.

## Features

- **Idempotent billing**: One billing record per `(student_id, billing_month)`
- **Deterministic billing keys**: `${studentRecordId}_${billingMonth}`
- **Pure functions**: All core rules are testable pure functions
- **Field validation**: Returns `MISSING_FIELDS` JSON if required fields are missing
- **Retry/backoff**: AirtableClient includes automatic retry with exponential backoff

## Billing Rules

### Lesson Pricing
- **Private (פרטי)**: ₪175 per lesson
- **Pair (זוגי)**: ₪0 (billed via subscription)
- **Group (קבוצתי)**: ₪0 (billed via subscription)

### Cancellation Rules
- **<24 hours before lesson**: Full charge (billable cancellation)
- **>=24 hours before lesson**: No charge

### Total Calculation
```
total = lessons_total + cancellations_total + subscriptions_total
```
**Note**: No VAT is charged.

## Required Airtable Fields

### Lessons Table
- `lesson_type` (or `Lesson_Type`): Single select field with values: `פרטי`, `זוגי`, `קבוצתי` (or `private`, `pair`, `group`)
- `cancellation_datetime` (or `Cancellation_Datetime`): DateTime field - when the lesson was cancelled
- `start_datetime`: DateTime field - when the lesson starts
- `status`: Single select field - lesson status
- `Student`: Linked record to Students table

### Subscriptions Table
- `monthly_amount` (or `Monthly_Amount`): Currency field - monthly subscription amount
- `subscription_type`: Single select field - type of subscription
- `subscription_start_date`: Date field
- `subscription_end_date`: Date field
- `pause_subscription`: Checkbox field
- `student_id`: Linked record to Students table

### MonthlyBills Table
- `billing_key` (or `idempotency_key`): Text field - unique key for idempotency
- `student_id`: Linked record to Students table
- `billing_month`: Text field - format: `YYYY-MM` (e.g., `2024-03`)
- `lessons_total`: Number field
- `cancellations_total`: Number field
- `subscriptions_total`: Number field
- `total`: Number field
- `status`: Single select field - bill status

## Usage

### Basic Example

```typescript
import { AirtableClient } from './services/airtableClient';
import { generateMonthlyBill, validateBillingFields } from './services/billingService';
import { nexusApi } from './services/nexusApi';

const client = new AirtableClient();

// Validate fields first
const missingFields = await validateBillingFields(client);
if (missingFields) {
  console.error('Missing fields:', JSON.stringify({ MISSING_FIELDS: missingFields }, null, 2));
  return;
}

// Fetch data
const students = await nexusApi.getStudents();
const lessons = await nexusApi.getLessons('2024-03-01T00:00:00', '2024-03-31T23:59:59');
const subscriptions = await nexusApi.getSubscriptions();

// Generate bill for a student
const student = students[0];
const bill = await generateMonthlyBill(
  client,
  student.id,
  student.name,
  '2024-03',
  lessons,
  subscriptions
);

console.log('Bill:', bill);
```

### Generate Bills for All Students

```typescript
import { generateAllMonthlyBills } from './services/billingService';

const bills = await generateAllMonthlyBills(
  client,
  '2024-03',
  lessons,
  subscriptions,
  students.map(s => ({ id: s.id, name: s.name }))
);
```

### Fetch Lessons with Cancellation Data

```typescript
import { fetchLessonsForBilling } from './services/billingService';

// Fetch lessons with cancellation datetime included
const lessons = await fetchLessonsForBilling(
  client,
  '2024-03-01T00:00:00',
  '2024-03-31T23:59:59'
);
```

## Missing Fields Handling

If required fields are missing, the service will return a `MISSING_FIELDS` object:

```json
{
  "MISSING_FIELDS": [
    {
      "table": "lessons",
      "field": "lesson_type (or Lesson_Type)",
      "why_needed": "Required to determine lesson pricing (Private=175, Pair/Group=0)",
      "example_values": ["פרטי", "זוגי", "קבוצתי", "private", "pair", "group"]
    }
  ]
}
```

## Unit Tests

Run unit tests for pure functions:

```bash
npx tsx services/billingService.test.ts
```

Tests cover:
- Lesson pricing calculation
- Cancellation billability (<24h rule)
- Billing month calculation
- Billing key generation
- Subscription amount parsing
- Complete billing calculation

## Architecture

### AirtableClient (DAL Layer)
- Single point of access for all Airtable operations
- Automatic retry with exponential backoff
- Handles rate limiting (429 errors)

### Billing Service
- **Pure functions**: `calculateLessonPrice`, `isCancellationBillable`, `calculateCancellationCharge`, etc.
- **Business logic**: `calculateStudentBilling`, `generateMonthlyBill`
- **Field validation**: `validateBillingFields`

### Idempotency
- Uses deterministic `billing_key`: `${studentRecordId}_${billingMonth}`
- Checks for existing bill before creating new one
- Updates existing bill if found

## Error Handling

The service throws errors in the following cases:
1. **MISSING_FIELDS**: Required Airtable fields are missing
2. **AIRTABLE_ERROR**: Airtable API errors (with retry)
3. **VALIDATION_ERROR**: Invalid input data

## Environment Variables

Required environment variables:
- `AIRTABLE_API_KEY` or `VITE_AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID` or `VITE_AIRTABLE_BASE_ID`

## Notes

- The service does **not** charge VAT
- Pair and Group lessons are **never** charged per-lesson (only via subscription)
- Cancellation charges require the `cancellation_datetime` field to determine if <24h
- All amounts are in Israeli Shekels (₪)
