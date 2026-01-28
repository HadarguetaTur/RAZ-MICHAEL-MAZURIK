# Ambiguous Fields Handling

This document lists fields that had ambiguous interpretations and how they were handled in the data contract.

## 1. `billable` vs `is_billable` (lessons table)

**Ambiguity**: The contract lists both `billable` and `is_billable` as optional fields with the note "[if exists]".

**Handling**: 
- Both fields are included in the `LessonsAirtableFields` type as optional
- Both are validated if present (accept boolean or 0/1)
- The contract does not specify which one takes precedence if both exist
- **Recommendation**: Check which field actually exists in Airtable and use only that one

**Action Required**: Verify which field name exists in your Airtable base and remove the other from the type if needed.

## 2. `full_name` in lessons table (multi-link)

**Ambiguity**: The contract specifies `full_name` is "linked to Students; may be multi-link".

**Handling**:
- Type is `LinkedRecord` which accepts both `string` (single link) and `string[]` (multi-link)
- Validator accepts both formats
- **Note**: If a lesson can have multiple students, the linked record will be an array

**Action Required**: Verify if lessons can have multiple students in your use case.

## 3. Linked record format

**Ambiguity**: Airtable linked records can be:
- Single string ID: `"rec123"`
- Array of string IDs: `["rec123", "rec456"]`
- Array of objects with `id` and `name`: `[{id: "rec123", name: "Student Name"}]`

**Handling**:
- Type `LinkedRecord` accepts `string | string[]`
- Validator checks for string(s) starting with "rec"
- **Note**: If Airtable returns objects with `id` and `name`, the validator will fail. This is intentional - the contract only specifies record IDs.

**Action Required**: If Airtable returns linked records as objects, you may need to extract the `id` field before validation.

## 4. `is_active` in Students (boolean vs 0/1)

**Ambiguity**: Contract says "boolean/0-1" but doesn't specify which format Airtable uses.

**Handling**:
- Type accepts `boolean | 0 | 1`
- Validator accepts all three formats
- **Note**: This allows flexibility but you may want to normalize to boolean in your application code

## 5. `is_lt_24h` in cancellations (strict 0/1)

**Ambiguity**: Contract explicitly says "0/1" (not boolean).

**Handling**:
- Type is strict: `0 | 1` (not boolean)
- Validator only accepts 0 or 1
- **Note**: This is stricter than `is_active` because the contract is explicit

## 6. `monthly_amount` in Subscriptions (string vs number)

**Ambiguity**: Contract says "currency string or number" but doesn't specify format.

**Handling**:
- Type accepts `string | number`
- Validator accepts both
- **Note**: Currency strings like "₪480.00" are accepted as-is

**Action Required**: If you need to parse currency strings, use a separate parsing function (not part of validation).

## 7. Hebrew field names in Billing table

**Ambiguity**: Billing table uses Hebrew field names which may cause issues with:
- Property access in JavaScript/TypeScript
- Sorting/filtering in code
- Database queries

**Handling**:
- Types use exact Hebrew field names: `'חודש חיוב'`, `'שולם'`, etc.
- Field map provides camelCase mappings for internal use
- Validator checks exact Hebrew field names

**Action Required**: Use the field map (`BillingFieldMap`) to convert to camelCase for internal code, then convert back when writing to Airtable.

## 8. Optional fields in lessons table

**Ambiguity**: `billable`/`is_billable`, `line_amount`, and `unit_price` are marked "[if exists]" but it's unclear if they're:
- Always present but sometimes null/empty
- Sometimes missing from the record entirely
- Calculated/formula fields (read-only)

**Handling**:
- All marked as optional (`?`) in TypeScript
- Validator only checks them if present
- **Note**: If these are formula fields, they're read-only and shouldn't be written to

**Action Required**: Verify if these fields are formula fields or regular fields in Airtable.

## 9. `subscription_end_date` and `pause_date` (optional dates)

**Ambiguity**: Contract marks these as optional but doesn't specify if they can be:
- `null`
- Empty string `""`
- Missing from record entirely

**Handling**:
- Type marks them as optional (`?`)
- Validator only checks format if present
- **Note**: If present, must be valid date string

**Action Required**: Determine if these can be `null` or empty string, and update validator if needed.

## Summary

All ambiguous fields were handled conservatively:
- Optional fields are marked optional in types
- Validators are lenient where the contract is ambiguous
- Strict validation where the contract is explicit (e.g., `is_lt_24h` must be 0 or 1)
- Field map provides camelCase conversion for easier code usage

**Next Steps**: 
1. Verify actual field names in your Airtable base
2. Check if linked records return as objects or just IDs
3. Determine if optional fields can be null vs missing
4. Update types/validators if your Airtable structure differs
