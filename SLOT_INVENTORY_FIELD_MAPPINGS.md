# Slot Inventory Field Mappings

## Airtable Field Name Mapping Assumptions

The `getOpenSlots()` function in `services/nexusApi.ts` uses the following field mappings from the Airtable `slot_inventory` table:

### Confirmed Field Mappings (from `contracts/fieldMap.ts` and `contracts/types.ts`):

1. **Status Field**: `סטטוס` (Hebrew: "Status")
   - Mapped via: `getField('slotInventory', 'סטטוס')`
   - Expected values: `'open'`, `'booked'`, `'blocked'`
   - Filter: Only `'open'` slots are returned

2. **Teacher ID Field**: `מורה` (Hebrew: "Teacher")
   - Mapped via: `getField('slotInventory', 'מורה')`
   - Type: Linked Record to `teachers` table
   - Returns: Array of record IDs (typically `['rec...']`)

3. **Source Field**: `נוצר מתוך` (Hebrew: "Created From")
   - Mapped via: `getField('slotInventory', 'נוצר_מתוך')`
   - Type: Linked Record to `weekly_slot` table
   - Returns: Array of record IDs (typically `['rec...']`)
   - Maps to: `OpenSlot.source`

4. **Start DateTime**: `StartDT` (Formula field)
   - Field name: `StartDT` (computed/formula field)
   - Type: ISO datetime string (e.g., `'2024-01-15T10:00:00Z'`)
   - Used for: Time range filtering and `OpenSlot.startDateTime`
   - Note: This is a computed field, read-only

5. **End DateTime**: `EndDT` (Formula field)
   - Field name: `EndDT` (computed/formula field)
   - Type: ISO datetime string (e.g., `'2024-01-15T11:00:00Z'`)
   - Used for: Time range filtering and `OpenSlot.endDateTime`
   - Note: This is a computed field, read-only

6. **Linked Lesson ID**: `lessons` (Linked Record field)
   - Field name: `lessons` (hardcoded, not in fieldMap)
   - Type: Linked Record to `lessons` table
   - Returns: Array of record IDs (typically `['rec...']`)
   - Maps to: `OpenSlot.linkedLessonId` (optional)
   - Note: This field may not exist in all Airtable bases. If missing, `linkedLessonId` will be `undefined`.

### Filter Logic:

The function filters records using Airtable formula:
```
AND(
  {StartDT} < "{endISO}",
  {EndDT} > "{startISO}",
  {סטטוס} = "פתוח"
)
```

This finds slots where:
- Slot starts before the query end time
- Slot ends after the query start time
- Status is exactly `'פתוח'` (Hebrew: "open")

### Debug Logging:

In DEV mode, the function:
1. Logs the total count of fetched records
2. Logs a sample record with all mapped fields
3. Logs the first record's field structure if records are found (to verify field mappings)
4. Warns if records are skipped due to missing required fields

### Field Verification:

If field names are incorrect or missing, check the DEV console logs for:
- `[getOpenSlots] First record fields inspection` - Shows all available fields in the first record
- `[getOpenSlots] Sample record` - Shows the mapped OpenSlot object

This helps identify if:
- `StartDT`/`EndDT` formula fields exist and return ISO strings
- `lessons` linked record field exists
- Field names match expectations
