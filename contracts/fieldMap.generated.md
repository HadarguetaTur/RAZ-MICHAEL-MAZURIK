# Field Map Documentation

This file is auto-generated documentation for the Airtable field mapping. It serves as a reference for developers working with Airtable tables.

## Tables Overview

| Table Key | Table ID | Primary Field | Display Name (Hebrew) |
|-----------|----------|---------------|----------------------|
| students | tblSEiCD3DrOfcnR8 | full_name | תלמידים |
| lessons | tblz6twflNw2iB832 | lesson_id | lessons |
| teachers | tblZz1lyROGM0Bkjy | teacher_id | מורים |
| weeklySlot | tbloC7G7ixYDMtdK6 | day_of_week | weekly_slot |
| slotInventory | tblqMt721kMMtRIWm | natural_key | slot_inventory |
| exams | tblHNAvjJHThiOE4a | exam_id | בחינות |
| cancellations | tblr0UIVvJr85vEfL | natural_key | cancellations |
| charges | tblyEsDpiRkw8doxQ | id | חיובים |
| subscriptions | tblEr05NrA5PT8dlH | id | מנויים |
| waitingList | tbl1tDzJo3CW91FU3 | waiting_id | רשימת המתנה |
| entities | tblhjI6Qe6yYDRF6L | ext_id | Entities |
| homework | tbllzo51a55mbuP0E | assignment_id | שיעורי בית |
| slotBlocks | tblk9sSVBGzvHdaIv | block_batch_id | Slot_Blocks |

## Key Fields by Table

### Students (תלמידים)
**Primary Field:** `full_name`

**Key Fields:**
- `full_name` - Primary field (computed: LOWER(RECORD_ID()) & phone_number)
- `phone_number` - Phone number
- `parent_phone` - Parent phone
- `parent_name` - Parent name
- `grade_level` - Grade level
- `is_active` - Active status
- `weekly_lessons_limit` - Weekly lessons limit

**Computed Fields (Read-only):**
- `student_id` - Formula: LOWER(RECORD_ID()) & phone_number
- `eligibility_this_week` - Eligibility check for this week
- `eligibility_next_week` - Eligibility check for next week
- `Subscription Monthly Amount` - Monthly subscription amount
- `כולל מע״מ ומנויים` - Total including VAT and subscriptions

### Lessons (שיעורים)
**Primary Field:** `lesson_id`

**Key Fields:**
- `lesson_id` - Primary field (Autonumber)
- `full_name` - Linked record to students
- `status` - Lesson status (מתוכנן, אישר הגעה, בוצע, בוטל, etc.)
- `lesson_date` - Lesson date
- `start_datetime` - Start datetime (ISO format)
- `end_datetime` - End datetime (ISO format)
- `teacher_id` - Linked record to teachers
- `duration` - Duration in minutes
- `lesson_type` - Lesson type (פרטי, זוגי, קבוצתי)
- `attendance_confirmed` - Attendance confirmed flag
- `price` - Lesson price

**Computed Fields (Read-only):**
- `פרטי השיעור` - Lesson details (formula)
- `count_this_week` - Count of lessons this week
- `billing_month` - Billing month (YYYY-MM format)
- `is_billable` - Is billable flag
- `unit_price` - Unit price (175₪ פרטי, 112.5₪ זוגי, 0₪ קבוצתי)
- `line_amount` - Line amount for billing
- `קיבולת` - Capacity (6 קבוצתי, 2 זוגי, 1 פרטי)
- `is_in_current_business_week` - Is in current business week
- `is_in_next_business_week` - Is in next business week
- `business_week_start` - Business week start date
- `business_week_end` - Business week end date
- `StartDT` - Start datetime (formula)
- `EndDT` - End datetime (formula)

### Teachers (מורים)
**Primary Field:** `teacher_id`

**Key Fields:**
- `teacher_id` - Primary field
- `full_name` - Full name
- `phone_number` - Phone number
- `email` - Email
- `subjects` - Subjects (multiple select)
- `hourly_rate` - Hourly rate
- `is_primary` - Is primary teacher
- `is_active` - Is active

### Charges (חיובים)
**Primary Field:** `id`

**Key Fields:**
- `id` - Primary field (Autonumber)
- `full_name` - Linked record to students
- `חודש חיוב` - Billing month
- `שולם` - Paid status
- `מאושר לחיוב` - Approved for billing

**Computed Fields (Read-only):**
- `כולל מע״מ ומנויים` - Total including VAT and subscriptions (Lookup)
- `Subscription Monthly Amount` - Monthly subscription amount (Rollup)
- `Late Cancellation Dates` - Late cancellation dates (Lookup)
- `מנוי קבוצתי` - Group subscription (Lookup)
- `מנוי בקתה` - Individual subscription (Lookup)
- `hours_before (from cancellations)` - Hours before from cancellations (Lookup)
- `lesson (from cancellations)` - Lesson from cancellations (Lookup)
- `cancellations` - Cancellations (Lookup)
- `Total Lessons Attended This Month` - Total lessons attended this month (Lookup)

### Subscriptions (מנויים)
**Primary Field:** `id`

**Key Fields:**
- `id` - Primary field (Autonumber)
- `student_id` - Linked record to students
- `subscription_start_date` - Subscription start date
- `subscription_end_date` - Subscription end date
- `monthly_amount` - Monthly amount (520₪ בקתה, 480₪ קבוצתי)
- `subscription_type` - Subscription type (זוגי, קבוצתי)
- `pause_subscription` - Pause subscription flag
- `pause_date` - Pause date

## Required Fields by Feature

### Students
- **list**: `full_name`, `phone_number`, `is_active`
- **details**: `full_name`, `phone_number`, `parent_phone`, `parent_name`, `grade_level`, `is_active`

### Lessons
- **list**: `lesson_id`, `full_name`, `status`, `lesson_date`, `start_datetime`, `end_datetime`
- **create**: `full_name`, `status`, `lesson_date`, `start_datetime`, `end_datetime`
- **updateStatus**: `status`

### Billing
- **buildMonthly**: `id`, `full_name`, `חודש חיוב`, `כולל מע״מ ומנויים`, `שולם`, `מאושר לחיוב`

### Subscriptions
- **list**: `id`, `student_id`, `subscription_start_date`, `subscription_type`, `monthly_amount`
- **create**: `student_id`, `subscription_start_date`, `subscription_type`, `monthly_amount`

### Teachers
- **list**: `teacher_id`, `full_name`, `is_active`

## Usage Examples

### Get Table ID
```typescript
import { getTableId } from './contracts/fieldMap';

const studentsTableId = getTableId('students'); // 'tblSEiCD3DrOfcnR8'
```

### Get Field Name
```typescript
import { getField } from './contracts/fieldMap';

const statusField = getField('lessons', 'status'); // 'status'
const studentField = getField('lessons', 'full_name'); // 'full_name'
```

### Check if Field is Computed
```typescript
import { isComputedField } from './contracts/fieldMap';

if (isComputedField('lessons', 'unit_price')) {
  // Don't try to write to this field
}
```

### Assert Required Fields
```typescript
import { assertRequiredFields } from './contracts/fieldMap';

const lessonFields = {
  full_name: ['rec...'],
  status: 'מתוכנן',
  lesson_date: '2024-03-20',
  start_datetime: '2024-03-20T16:00:00',
  end_datetime: '2024-03-20T17:00:00',
};

assertRequiredFields('lessons', lessonFields, 'create');
```

### Filter Computed Fields
```typescript
import { filterComputedFields } from './contracts/fieldMap';

const allFields = {
  status: 'מתוכנן',
  unit_price: 175, // Computed - will be filtered out
  start_datetime: '2024-03-20T16:00:00',
};

const writableFields = filterComputedFields('lessons', allFields);
// Result: { status: 'מתוכנן', start_datetime: '2024-03-20T16:00:00' }
```

## TODO: Missing Fields

The following fields are used in code but are not documented in the Airtable report:

1. **lessons.Student** - Used in createLesson and conflict checks (might be lookup field)
2. **lessons.Teacher** - Used in createLesson and conflict checks (might be lookup field)
3. **lessons.Student_ID** - Used in mapAirtableToLesson
4. **lessons.Teacher_ID** - Used in mapAirtableToLesson
5. **lessons.Student_Name** - Used in mapAirtableToLesson
6. **lessons.Teacher_Name** - Used in mapAirtableToLesson

These fields need to be verified in Airtable and added to the field map if they exist.
