# Strict Field Mapping Implementation

## Summary

Implemented strict field mapping for Airtable lesson creation to prevent "Unknown field name" errors.

## Changes Made

### 1. Updated `config/airtable.ts`
- Removed read-only formula fields from mapping (unitPrice, lineAmount, etc.)
- Added clear comments about optional fields that need discovery
- Only writable fields are included in the mapping

### 2. Refactored `services/nexusApi.ts` → `createLesson()`
- **Removed all hardcoded field names** (including "Subject")
- **Added `addFieldIfMapped()` helper** - only adds fields if they exist in config
- **Strict validation**: Fields are only included if:
  1. Field key exists in `AIRTABLE_CONFIG.fields`
  2. Field value is defined (not undefined/null)
  3. Field name in config is not undefined/null
- **Removed fallback mechanism** - no more trying alternative field names
- **Subject field removed** - will not be sent until field name is discovered and added to config

### 3. Enhanced `getLessons()` logging
- Logs ALL field names from existing lesson records
- Identifies Hebrew field names
- Shows field structure for discovery

## Current Field Mappings

### Required Fields (always sent):
- `lessonStartDatetime` → `'start_datetime'`
- `lessonEndDatetime` → `'end_datetime'`
- `lessonStatus` → `'status'`
- `lessonDate` → `'lesson_date'`
- `lessonStudent` → `'Student'` (linked record)

### Optional Fields (sent if value provided):
- `lessonTeacher` → `'Teacher'` (linked record)
- `lessonDetails` → `'פרטי השיעור'` (notes)

### Fields NOT Mapped (will not be sent):
- `lessonSubject` - **Not in config** (removed to prevent errors)
- `lessonType` - **Not in config** (removed to prevent errors)

## How to Discover Missing Field Names

1. **Open browser console** when viewing Calendar page
2. **Look for logs** starting with `[DEBUG getLessons] STEP 3`
3. **Check the output**:
   ```
   [DEBUG getLessons] STEP 3 - ALL field names in existing lesson record: [...]
   [DEBUG getLessons] STEP 3 - FIELD MAPPING DISCOVERY:
   ```
4. **Find the field name** for subject/type (likely Hebrew like "סוג שיעור")
5. **Add to config**:
   ```typescript
   // In config/airtable.ts
   lessonSubject: 'actual_field_name_from_logs',
   lessonType: 'actual_field_name_from_logs',
   ```
6. **Uncomment the code** in `createLesson()`:
   ```typescript
   if (lesson.subject) {
     addFieldIfMapped('lessonSubject', lesson.subject, airtableFields);
   }
   ```

## Safeguards

1. **Field existence check**: `addFieldIfMapped()` checks if field is defined in config
2. **Value validation**: Only adds field if value is not undefined/null
3. **No hardcoded names**: All field names come from config
4. **Clear errors**: If field mapping is missing, error message is clear

## Testing

1. Create a lesson with a selected student
2. Check console for `[DEBUG createLesson]` logs
3. Verify payload only contains mapped fields
4. Lesson should create successfully without "Unknown field name" errors
5. Check Airtable to confirm record was created

## Acceptance Criteria

✅ No "Unknown field name" errors  
✅ Lesson record appears in Airtable  
✅ Only mapped fields are sent in payload  
✅ All field names come from config (no hardcoded names)
