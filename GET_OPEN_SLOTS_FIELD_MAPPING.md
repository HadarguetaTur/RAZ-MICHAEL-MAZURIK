# getOpenSlots — Airtable Field Name Mapping

**Function:** `nexusApi.getOpenSlots(startISO, endISO, teacherId?)`  
**Return type:** `Promise<SlotInventoryOpenSlot[]>` — normalized shape `{ id, teacherId, startDateTime, endDateTime, status, source?, linkedLessonId? }` (camelCase).  
**Table:** `slot_inventory` (config: `AIRTABLE_CONFIG.tables.slot_inventory`)

## Airtable field name mapping (from `contracts/fieldMap.ts` FIELDS.slotInventory)

| Code (camelCase) | Airtable field key in fieldMap | Assumption |
|------------------|---------------------------------|------------|
| `startDateTime`  | `StartDT`                       | Formula or datetime field returning ISO string. Used in filter: `{StartDT} < endISO`. |
| `endDateTime`    | `EndDT`                         | Formula or datetime field returning ISO string. Used in filter: `{EndDT} > startISO`. |
| `status`         | `סטטוס`                         | Single select or text. Filter: `{סטטוס} = "open"`. Values "open" only for this API; "reserved" not included yet. |
| `teacherId`      | `מורה`                          | Linked record to teachers. Stored as array of record IDs. |
| `source`         | `נוצר_מתוך` → `נוצר מתוך`       | Linked record to `weekly_slot`. First linked ID mapped to `source`. |
| `linkedLessonId` | `lessons`                       | Linked record to lessons. First linked ID mapped to `linkedLessonId`. May be missing in some bases; then `undefined`. |

## If field names are unknown

In **DEV only**, `getOpenSlots` logs:

- `[getOpenSlots] count=<n>, sample: <first SlotInventoryOpenSlot>`
- `[getOpenSlots] First record raw fields (inspect if mapping fails): <array of Airtable field names>`

Use the “First record raw fields” log to see the actual keys returned by Airtable, then adjust `contracts/fieldMap.ts` (FIELDS.slotInventory) or the getField keys in `services/nexusApi.ts` to match. Do not guess; use that log or the Airtable UI.

## Filter logic

- `AND({StartDT} < "<endISO>", {EndDT} > "<startISO>", {סטטוס} = "open")`
- Optional: `FIND("<teacherId>", ARRAYJOIN({מורה})) > 0` when `teacherId` is a `rec...` ID.

Only slots with status **"open"** are returned. "reserved" (or Hebrew equivalents) can be added later if needed.
