# Debug Report: Airtable "Student" Field Error

## Error Message
```
Field "Student" cannot accept the provided value when creating a Lesson.
```

## Step 1: Current Implementation Analysis

### Where Lesson Creation Happens
- **File**: `services/nexusApi.ts`
- **Function**: `createLesson()` (line ~901)
- **Called from**: `components/Calendar.tsx` → `handleSave()` (line ~212)

### Current Payload Structure
```javascript
{
  fields: {
    start_datetime: "2024-03-24T16:00:00",
    end_datetime: "2024-03-24T17:00:00",
    status: "מתוכנן",
    lesson_date: "2024-03-24",
    Student: ["recXXXX"]  // ← This is what's being sent
  }
}
```

### Field Name Configuration
- **Config file**: `config/airtable.ts`
- **Field name**: `lessonStudent: 'Student'` (line 32)
- **Table**: `lessons: 'tblz6twflNw2iB832'`

## Step 2: Expected vs Actual Format

### What Airtable Expects (Linked Record Field)
- **Type**: Linked record field
- **Format**: Array of record ID strings: `["recXXXX"]`
- **Record IDs must be**: From the Students table (`tblSEiCD3DrOfcnR8`)

### What We're Sending
- ✅ Array format: `["recXXXX"]`
- ✅ String record ID starting with "rec"
- ❓ Field name might be wrong
- ❓ Record ID might be invalid

## Step 3: Debugging Steps Added

### Added Logs in `createLesson()`:
1. **STEP 0** (Calendar.tsx): Logs UI state values
2. **STEP 1**: Logs incoming `studentId` value and type
3. **STEP 2**: Logs prepared field value and field name
4. **STEP 3**: Logs the field being set
5. **STEP 4**: Logs complete payload before sending
6. **STEP 5**: Logs success/error response

### Added Logs in `getLessons()`:
- Inspects existing lesson records to see actual Student field structure
- Logs all field names to detect Hebrew field names
- Shows how Student field is returned when reading

## Step 4: Common Issues to Check

### Issue A: Field Name Mismatch
**Possible field names in Airtable:**
- `"Student"` (English)
- `"תלמיד"` (Hebrew)
- `"student"` (lowercase)
- `"Student_ID"` (if it's a formula field, not a linked record)

**Fix**: Try alternative field names if "Student" fails

### Issue B: Invalid Record ID
**Symptoms:**
- Record ID doesn't start with "rec"
- Record ID is from wrong table
- Record ID format is corrupted

**Fix**: Validate record ID format and ensure it's from Students table

### Issue C: Field Type Mismatch
**If field is:**
- Single linked record → send `["recXXXX"]` ✅ (current)
- Multiple linked records → send `["recXXXX"]` ✅ (current)
- Formula/Lookup field → Cannot write to it ❌

**Fix**: Verify field type in Airtable schema

## Step 5: Next Steps

1. **Run the code** and check console logs
2. **Compare** what's sent vs what's in existing records
3. **Verify** field name matches exactly (case-sensitive, no extra spaces)
4. **Confirm** record ID is valid and from Students table
5. **Apply fix** based on findings

## Expected Console Output

When creating a lesson, you should see:
```
[DEBUG Calendar.handleSave] STEP 0 - Creating lesson with: {...}
[DEBUG createLesson] STEP 1 - Incoming studentId: "recXXXX"
[DEBUG createLesson] STEP 2 - Prepared Student field value: ["recXXXX"]
[DEBUG createLesson] STEP 4 - Complete Airtable payload: {...}
[DEBUG createLesson] STEP 5 - SUCCESS! or ERROR
```

## Root Cause Analysis (To Be Determined)

After running with debug logs, check:
1. What value is in `studentId`?
2. What field name is being used?
3. What does Airtable error response say?
4. How does Student field appear in existing records?
