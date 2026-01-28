# Overlap & Slot Warning – Acceptance Checklist & Limitations

## Acceptance criteria (confirmed)

| Criterion | Status | Notes |
|-----------|--------|--------|
| **Calendar renders open slots in correct columns/time** | ✓ | Open slots use `itemDate(item)` from `startDateTime` (local date via `new Date(...).getFullYear/Month/Date`). Week/day grid uses `topOffset = (startD.getHours() - 8) * 96 + (startD.getMinutes() / 60) * 96` with local hours/minutes. Agenda groups by the same `itemDate`. |
| **Lesson-over-slots modal appears only when overlap exists** | ✓ | SlotOverlapModal is shown only when `findOverlappingOpenSlots(lessonDraft, openSlots).length > 0`. Save is blocked and modal is shown; otherwise save proceeds without modal. |
| **Slot-over-lessons modal appears only when overlap exists** | ✓ | SlotOverlapsLessonModal is shown only when `findOverlappingLessons(slotDraft, lessonsForSlotOverlap).length > 0` on slot-edit Save. |
| **Save + close slot: link records if linking fields exist; otherwise skip linking but still close** | ✓ | `updateSlotInventory` sets `status: 'booked'` always. When `linkedLessonId` is present it tries `getField('slotInventory','lessons')` inside try/catch; on success it sets `fields[lessonsField] = [lessonId]`. On missing field or getField throw, linking is skipped and only status is updated. |
| **Noisy logs removed; only DEV logs kept** | ✓ | Removed all `#region agent log` / `fetch('http://127.0.0.1:7242/...')` and verbose `console.log` from Calendar and from `updateSlotInventory` in nexusApi. Calendar `console.error`/`console.warn` are gated with `import.meta.env?.DEV`. updateSlotInventory keeps `console.warn` for permission/retry (DEV-only style) and adds a DEV-only warn when linking is skipped. |

## Known limitations

1. **Overlap uses currently loaded data only**  
   Lesson-over-slots uses in-memory `openSlots`; slot-over-lessons uses in-memory `lessons` (filtered to SCHEDULED/COMPLETED). No extra network calls. If the range or data is stale, overlap detection can be incomplete.

2. **Linking field name**  
   Linking assumes `slot_inventory` has a field mapped as `'lessons'` in the field map. If the base uses another name and it is not mapped, linking is skipped and only status is updated.

3. **Close = “booked”**  
   “Save + close slot” sets status to `'booked'` (and link when possible). It does not set a separate `closed_reason` or `status = 'closed'`; schema may be extended later.

4. **Slot edit only in Calendar**  
   “Edit open slot” and the slot-over-lessons warning exist only in Calendar (agenda and week/day). There is no create-slot-inventory or slot-edit flow in Availability or elsewhere that uses this warning.

5. **Timezone**  
   Slot and lesson times are interpreted in the browser’s local timezone. Consistency with Airtable (e.g. UTC) depends on how getOpenSlots/getLessons format and return datetimes.
