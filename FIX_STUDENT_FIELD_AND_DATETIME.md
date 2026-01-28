# Fix: Student Field Rejection + End Datetime Logic

## Issues Fixed

### Part A: Identify Writable Student Linked Record Field
**Problem**: "Student" field cannot accept the provided value - likely because "Student" is a lookup field (read-only), not the writable linked record field.

**Solution**: Enhanced `getLessons()` logging to identify the actual writable linked record field:
- Logs all field names from existing lesson records
- Analyzes each student-related field to determine if it's writable
- Checks if field contains array of `rec...` IDs (writable) vs array of objects with names (lookup, not writable)
- Identifies Hebrew fields containing "תלמיד"

**How to use**:
1. Open browser console when viewing Calendar page
2. Look for `[DEBUG getLessons] PART A` logs
3. Find the field marked as "WRITABLE linked record field"
4. Update `config/airtable.ts` with the correct field name:
   ```typescript
   lessonStudent: 'actual_writable_field_name', // e.g. 'student_id' or 'תלמידים'
   ```

### Part B: Fix createLesson Payload Mapping
**Changes**:
- Added strict validation guard for student ID (must start with "rec")
- Clear error messages if student ID is invalid
- Uses mapped field name from config (no hardcoded "Student")
- Logs which field is being written to for debugging

**Validation**:
- Student ID must be a string starting with "rec"
- If invalid, blocks submit with clear UI error
- Calendar component already validates before calling API

### Part C: Fix end_datetime Generation
**Problem**: `end_datetime` was before `start_datetime` due to timezone conversion:
- `start_datetime`: "2026-01-18T08:00:00" (local time, no timezone)
- `end_datetime`: "2026-01-18T07:00:00.000Z" (UTC, converted from local)

**Solution**: Use consistent local time format for both:
- Both `start_datetime` and `end_datetime` use format: `YYYY-MM-DDTHH:mm:00` (no timezone)
- Calculate end by adding duration in milliseconds to start
- Extract date/time components manually to avoid timezone conversion
- Added validation: `end > start` check before sending

**Code**:
```typescript
const startDatetime = `${lesson.date}T${lesson.startTime}:00`;
const startDate = new Date(startDatetime);
const endDate = new Date(startDate.getTime() + (lesson.duration * 60 * 1000));

// Format end in same local format (no timezone conversion)
const endYear = endDate.getFullYear();
const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
const endDay = String(endDate.getDate()).padStart(2, '0');
const endHours = String(endDate.getHours()).padStart(2, '0');
const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
const endDatetime = `${endYear}-${endMonth}-${endDay}T${endHours}:${endMinutes}:00`;

// Validation
if (endDate.getTime() <= startDate.getTime()) {
  throw { message: 'Invalid duration: end time must be after start time', ... };
}
```

## Testing Steps

1. **View existing lessons** to trigger field discovery logs:
   - Open Calendar page
   - Check console for `[DEBUG getLessons] PART A` logs
   - Identify the writable student field name

2. **Update config** if needed:
   - If logs show a different field name, update `config/airtable.ts`
   - Change `lessonStudent: 'Student'` to the correct field name

3. **Create a lesson**:
   - Select a student
   - Set date, time, and duration
   - Click "צור שיעור"
   - Check console for `[DEBUG createLesson] PART B` and `PART C` logs

4. **Verify**:
   - No "Student cannot accept value" errors
   - `end_datetime > start_datetime` in logs
   - Lesson appears in Airtable

## Acceptance Criteria

✅ No "Student cannot accept value" errors  
✅ `end_datetime` is always after `start_datetime`  
✅ Both datetimes use consistent format (local time, no timezone)  
✅ Student ID validation blocks invalid IDs with clear error  
✅ Lesson creation succeeds and record appears in Airtable
