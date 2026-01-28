/**
 * Conflict override behaviour: documenting "המשך בכל זאת" (save despite overlap).
 *
 * TODO: Add override_conflict (boolean) and conflict_summary (text) to Airtable when ready:
 *   - lessons table: fields not present in contracts/fieldMap.ts FIELDS.lessons
 *   - slot_inventory table: fields not present in contracts/fieldMap.ts FIELDS.slotInventory
 * Until then, override is local-only: we log conflict_summary to console and to the
 * event log (CONFLICT_OVERRIDE) for ErrorCenter. We do NOT send override_conflict /
 * conflict_summary to the API so we don't break writes.
 */
export const CONFLICT_OVERRIDE_FIELDS_LOCAL_ONLY = true;
