# Fix: Airtable "Student" Field Error When Creating Lessons

## Root Cause Analysis

### Current Implementation
- **Location**: `services/nexusApi.ts` → `createLesson()` function
- **Field Name Used**: `AIRTABLE_CONFIG.fields.lessonStudent` = `"Student"`
- **Format Sent**: `["recXXXX"]` (array of record ID string) ✅ Correct format
- **Table**: Lessons table (`tblz6twflNw2iB832`)

### How Student Field is Read (from existing lessons)
From `mapAirtableToLesson()`:
```javascript
studentId: fields['Student_ID'] || fields['Student']?.[0]?.id || ''
```
This shows:
- When reading, `fields['Student']` is an array of objects: `[{id: 'rec...', name: '...'}]`
- Field name "Student" exists and is a linked record field ✅

### Most Likely Issues

#### Issue #1: Field Name Case/Encoding Mismatch (MOST LIKELY)
**Problem**: Airtable field names are case-sensitive and must match exactly.
- Config uses: `"Student"` (English, capital S)
- Airtable might have: `"תלמיד"` (Hebrew) or `"student"` (lowercase)

**Evidence**: Error says "Field 'Student' cannot accept..." - suggests field exists but format is wrong OR field name is slightly different.

#### Issue #2: Invalid Record ID
**Problem**: The `studentId` might not be a valid record ID from Students table.
- Must start with "rec"
- Must be from Students table (`tblSEiCD3DrOfcnR8`)
- Must be exactly 17 characters (e.g., "recXXXXXXXXXXXXXX")

#### Issue #3: Field Type Mismatch
**Problem**: If "Student" is a formula/lookup field (read-only), we cannot write to it.
- Need to use the actual linked record field name instead

## Debugging Added

### Step-by-Step Logging
1. **STEP 0** (Calendar.tsx): Logs UI state before API call
2. **STEP 1**: Validates and logs incoming `studentId`
3. **STEP 2**: Prepares field value and logs format
4. **STEP 3**: Sets field in payload
5. **STEP 4**: Logs complete payload before sending
6. **STEP 5**: Logs Airtable response (success or detailed error)

### Additional Checks
- Student ID validation (must start with "rec")
- Pre-flight check: Verifies student exists in Students table
- Field name fallback: Tries alternative field names if primary fails

## Expected Console Output

When you create a lesson, check the browser console for:

```
[DEBUG Calendar.handleSave] STEP 0 - Creating lesson with: {
  studentId: "recXXXX",
  selectedStudent: {id: "recXXXX", name: "..."},
  ...
}

[DEBUG createLesson] STEP 1 - Incoming studentId: "recXXXX"
[DEBUG createLesson] STEP 2 - Prepared Student field value: ["recXXXX"]
[DEBUG createLesson] STEP 4 - Complete Airtable payload: {
  "fields": {
    "Student": ["recXXXX"],
    ...
  }
}

[DEBUG createLesson] STEP 5 - ERROR or SUCCESS
```

## Fix Strategy

### If Field Name is Wrong
**Solution**: Update `config/airtable.ts`:
```typescript
lessonStudent: 'תלמיד', // or whatever the actual field name is
```

### If Record ID is Invalid
**Solution**: Ensure StudentPicker returns valid Student object with `id` property.

### If Format is Wrong
**Solution**: Already correct (`["recXXXX"]`), but verify Airtable expects this format.

## Next Steps

1. **Run the code** and create a lesson
2. **Check console logs** for all STEP outputs
3. **Compare** the payload with an existing lesson record structure
4. **Identify** the exact mismatch
5. **Apply fix** based on findings

## Quick Fix (If Field Name is Hebrew)

If logs show field name should be Hebrew, update:
```typescript
// config/airtable.ts
lessonStudent: 'תלמיד', // Change from 'Student' to Hebrew name
```
