# Airtable Data Contract

Strict TypeScript types and runtime validation for Airtable tables.

## Files

- **`types.ts`**: TypeScript type definitions for all Airtable tables
- **`validators.ts`**: Runtime validation functions (manual, no dependencies)
- **`fieldMap.ts`**: Mapping between Airtable field names and camelCase keys
- **`AMBIGUOUS_FIELDS.md`**: Documentation of ambiguous fields and how they're handled

## Usage

### Basic Validation

```typescript
import { validateLessonsFields, MissingFieldsError } from './contracts';

// Validate an Airtable record
const airtableRecord = {
  id: 'rec123',
  fields: {
    lesson_id: 'L001',
    full_name: 'rec456',
    status: 'מתוכנן',
    // ... other fields
  }
};

const result = validateLessonsFields(airtableRecord.fields);

if (!result.success) {
  if (result.missingFields) {
    // Return MISSING_FIELDS error
    throw { MISSING_FIELDS: result.missingFields };
  }
  console.error('Validation errors:', result.errors);
} else {
  // Use validated data
  const validFields = result.data;
}
```

### Field Mapping

```typescript
import { transformToCamelCase, transformFromCamelCase } from './contracts/fieldMap';

// Convert Airtable fields to camelCase
const camelCaseData = transformToCamelCase('lessons', airtableRecord.fields);
// { lessonId: 'L001', fullName: 'rec456', ... }

// Convert back to Airtable format
const airtableFields = transformFromCamelCase('lessons', camelCaseData);
```

### Type Safety

```typescript
import { LessonsAirtableFields, StudentsAirtableFields } from './contracts/types';

// Type-safe access to fields
function processLesson(fields: LessonsAirtableFields) {
  // TypeScript knows all available fields
  const lessonId = fields.lesson_id;
  const lessonType = fields.lesson_type; // Type: 'פרטי' | 'זוגי' | 'קבוצתי'
  
  // Optional fields are properly typed
  if (fields.billable !== undefined) {
    // Handle billable flag
  }
}
```

## Tables

### Students (tblSEiCD3DrOfcnR8)
- Primary: `full_name`
- Fields: `phone_number`, `is_active`, linked records

### lessons (tblz6twflNw2iB832)
- Primary: `lesson_id`
- Fields: `full_name` (linked), `status`, `lesson_date`, `start_datetime`, `end_datetime`, `lesson_type`, `duration`, `billing_month`
- Optional: `billable`/`is_billable`, `line_amount`, `unit_price`

### cancellations (tblr0UIVvJr85vEfL)
- Primary: `natural_key`
- Fields: `lesson` (linked), `student` (linked), `cancellation_date`, `hours_before`, `is_lt_24h`, `is_charged`, `charge`, `billing_month`

### Subscriptions (tblEr05NrA5PT8dlH)
- Primary: `id`
- Fields: `student_id` (linked), `subscription_start_date`, `subscription_end_date`, `monthly_amount`, `subscription_type`, `pause_subscription`, `pause_date`

### Billing (tbllyEsDpiRkw8doxQ)
- Primary: `id`
- Fields: `חודש חיוב` (Hebrew), `שולם` (Hebrew), `מאושר לחיוב` (Hebrew), `תלמיד` (Hebrew, linked)

## Error Handling

If required fields are missing, validators return a `MissingFieldsError`:

```typescript
if (result.missingFields) {
  const error: MissingFieldsError = {
    MISSING_FIELDS: result.missingFields
  };
  // Return or throw this error
}
```

## Notes

- All validators are **strict** - they only accept fields listed in the contract
- Unknown fields are **ignored** (not validated, not included in result)
- Linked records accept both single IDs (`"rec123"`) and arrays (`["rec123", "rec456"]`)
- Hebrew field names in Billing table are preserved exactly as in Airtable
- See `AMBIGUOUS_FIELDS.md` for details on ambiguous field handling
