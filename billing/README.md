# Billing Engine

Node.js + TypeScript billing engine for creating/updating monthly billing records per student.

## Architecture

- **`airtableClient.ts`**: Enhanced Airtable client with CRUD, pagination, filtering, and retry/backoff
- **`billingRules.ts`**: Pure calculation functions (no side effects, easily testable)
- **`billingEngine.ts`**: Main orchestration logic
- **`domainErrors.ts`**: Domain-specific error types
- **`index.ts`**: CLI for manual runs

## Billing Rules

### A) Lessons Contribution (`lessons_total`)

Include a lesson only if:
- `lesson.billing_month == billingMonth`
- `lesson.status` is NOT "בוטל" or "בוטל ע\"י מנהל"
- `lesson.lesson_type == "פרטי"` (only private lessons are billed per-lesson)

Amount per lesson:
- Prefer `line_amount` if present
- Otherwise: 175

**Note**: `lesson_type` "זוגי" and "קבוצתי" contribute 0 (never billed per lesson).

### B) Cancellations Contribution (`cancellations_total`)

Include a cancellation only if:
- `cancellation.billing_month == billingMonth`
- `cancellation.is_lt_24h == 1`

Then:
- If `is_charged == true` => include in `cancellations_total`
- If `is_charged == false` => mark as pending approval (do NOT include)

Amount:
- Prefer `cancellation.charge` if present
- Otherwise, if cancellation has a linked lesson:
  - If `lesson.lesson_type == "פרטי"`: charge 175
  - If `lesson.lesson_type == "זוגי"` or "קבוצתי": charge 0 (unless explicit charge exists)
- If charge cannot be determined: return `MISSING_FIELDS`

### C) Subscription Contribution (`subscriptions_total`)

For the given student + billingMonth:
- Find active subscriptions where:
  - `pause_subscription != true`
  - `subscription_start_date <= endOfMonth(billingMonth)`
  - `subscription_end_date` is empty OR `subscription_end_date >= startOfMonth(billingMonth)`

`subscriptions_total = sum(monthly_amount of active subscriptions)`

**Note**: If overlapping subscriptions exist, return `MISSING_FIELDS` with a request for the business rule (do not guess).

### D) Billing Status

- `draft`: created/updated
- `pending_approval`: `pending_cancellations_count > 0`
- `approved`: `pending_cancellations_count == 0`
- `paid`: if `Billing.שולם == true` (preserve paid flag)

### E) Upsert Logic

Upsert Billing by (student, billingMonth):
1. Search Billing records for this student + month
2. If none: create
3. If one: update totals + status
4. If more than one: throw `DuplicateBillingRecordsError` (include record IDs, do not update)

## Usage

### CLI

```bash
# Build billing for a specific student
npm run billing:build -- --student rec123 --month 2024-03

# Build billing for all active students
npm run billing:build -- --month 2024-03 --all

# Dry run (show what would be created)
npm run billing:build -- --student rec123 --month 2024-03 --dry-run
```

### Programmatic API

```typescript
import { AirtableClient } from './billing/airtableClient';
import { buildStudentMonth, buildMonthForAllActiveStudents } from './billing/billingEngine';

const client = new AirtableClient();

// Build for one student
const result = await buildStudentMonth(client, 'rec123', '2024-03');

if (result instanceof MissingFieldsError) {
  console.error('Missing fields:', result.missingFields);
} else {
  console.log('Billing created:', result);
}

// Build for all active students
const allResults = await buildMonthForAllActiveStudents(client, '2024-03');
console.log(`Success: ${allResults.success.length}, Errors: ${allResults.errors.length}`);
```

## Error Handling

### MissingFieldsError

Returned when required fields are missing or charge cannot be determined:

```typescript
{
  MISSING_FIELDS: [
    {
      table: "cancellations",
      field: "lesson (linked record)",
      why_needed: "Required to determine cancellation charge when charge field is not set",
      example_values: ["rec123"]
    }
  ]
}
```

### DuplicateBillingRecordsError

Thrown when multiple billing records exist for the same student + month:

```typescript
{
  code: "DUPLICATE_BILLING_RECORDS",
  studentRecordId: "rec123",
  billingMonth: "2024-03",
  recordIds: ["rec456", "rec789"]
}
```

## Environment Variables

Required:
- `AIRTABLE_API_KEY` or `VITE_AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID` or `VITE_AIRTABLE_BASE_ID`

## Table IDs

- Students: `tblSEiCD3DrOfcnR8`
- lessons: `tblz6twflNw2iB832`
- cancellations: `tblr0UIVvJr85vEfL`
- Subscriptions: `tblEr05NrA5PT8dlH`
- Billing: `tbllyEsDpiRkw8doxQ`

## Notes

- No VAT is charged
- `billingKey` format: `${studentRecordId}_${billingMonth}`
- All calculations are pure functions (no side effects)
- The engine uses the strict data contract types from `contracts/types.ts`
- Linked records are handled as string IDs or arrays of string IDs
- Month boundaries use Asia/Jerusalem timezone (see timezone note below)

## Edge Cases & Hardening

### 1. Multi-Student Lessons

- **Private lessons (`פרטי`) with multiple students**: Returns `MISSING_FIELDS` asking for split rule (split evenly / per student / disallow)
- **Pair/Group lessons (`זוגי`/`קבוצתי`) with multiple students**: Amount is 0, no split needed

### 2. Cancellations Without Linked Lesson

- If `charge` field exists: uses it
- If `charge` missing and no linked lesson: returns `MISSING_FIELDS` (need explicit charge)

### 3. Retroactive Changes

- Re-running engine updates totals (idempotent)
- Always rebuild affected months when moving lessons between months

### 4. Duplicate Billing Records

- If duplicates found: throws `DuplicateBillingRecordsError` and **stops immediately**
- Manual cleanup required before re-running

### 5. Timezone

- Month boundary logic uses **Asia/Jerusalem** timezone
- Current implementation uses local dates (works if Airtable dates are consistent)
- For production with proper DST handling, use a timezone library (date-fns-tz or luxon)

## Operational Notes

See [`OPERATIONAL_NOTES.md`](./OPERATIONAL_NOTES.md) for detailed instructions on:
- Safe month rebuild process
- Handling errors and duplicates
- Retroactive changes
- Verification procedures
- Emergency procedures
