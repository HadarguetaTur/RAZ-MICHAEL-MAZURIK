# Repository Audit & Execution Plan: Open Slots on Calendar + Overlap Modal

**Goal:** Show open booking slots (slot_inventory) on the calendar UI with a different style, and add a non-blocking confirmation modal when creating/updating a lesson that overlaps an open slot.

**Scope:** Audit only — no code implementation. Output: file paths, existing types, proposed types, and a step-by-step plan (max 12 steps).

---

## 1) Calendar UI and Data Loading for Lessons

### Calendar UI components

| File | Purpose | Used by |
|------|---------|---------|
| `components/Calendar.tsx` | Main calendar screen (week/day/agenda/recurring). Inline grid + side panel for lesson create/edit. | `App.tsx` (tab `calendar`) |
| `components/CalendarWeekView.tsx` | Reusable week/day grid; accepts `CalendarEvent[]`, `onSlotClick`, `onEventClick`. | **Not used by Calendar.tsx.** Used by `Availability.tsx` (per EXECUTION_PLAN_SLOT_INVENTORY) |
| `components/WeeklySlotsGrid.tsx` | Grid for weekly slots (availability). | Availability / weekly_slot UI |

The **live** calendar UI is entirely in `components/Calendar.tsx`. It does **not** use `CalendarWeekView`; it implements its own week/day grid (lines 387–434) and agenda list (lines 361–385).

### Where `getLessons(start, end, teacherId?)` is called

| Location | File | Call |
|----------|------|------|
| **Calendar (main)** | `components/Calendar.tsx` | `nexusApi.getLessons(startDate, endDateStr)` in `useEffect` (lines 56, 301). No `teacherId` passed. |
| **Data layer** | `data/resources/lessons.ts` | `nexusApi.getLessons(start, end, teacherId)` inside `getLessons(range, teacherId?)` (line 35). |
| **Hooks** | `data/hooks/useLessons.ts` | Uses `getLessons(range, teacherId)` from `data/resources/lessons.ts` (line 28). Calendar does **not** use this hook; it calls `nexusApi.getLessons` directly. |
| **Other** | `components/Students.tsx` | `nexusApi.getLessons(startDateStr, endDateStr)` (line 50). |
| **Other** | `services/slotManagementService.ts` | `nexusApi.getLessons(dateStr, dateStr, slot.teacherId)` (line 326). |

So the **calendar data flow** is: `Calendar.tsx` → `nexusApi.getLessons(startDate, endDateStr)` in a `useEffect` depending on `startDate`, `endDateStr`. Lessons are stored in `lessons` state; there is no slot_inventory or open-slots loading in Calendar today.

---

## 2) Airtable Service Layer (Lessons + Weekly Slots / Slot Inventory)

### File: `services/nexusApi.ts`

- **Lessons**
  - `getLessons(start: string, end: string, teacherId?: string): Promise<Lesson[]>` — approx. lines 661–858. Reads from Airtable `lessons` table (`config/airtable.ts` → `tables.lessons`). Expects `start`/`end` as `YYYY-MM-DD`.
  - `createLesson(lesson: Partial<Lesson>): Promise<Lesson>` — approx. 2189–2594. Writes to lessons table; does lesson-vs-lesson conflict check, no slot_inventory check.
  - `updateLesson(id: string, updates: Partial<Lesson>): Promise<Lesson>` — approx. 1671+.
  - `checkLessonConflicts(startDatetime, endDatetime, studentId?, teacherId?, excludeLessonId?): Promise<Lesson[]>` — checks overlapping **lessons** only.

- **Slot inventory**
  - `getSlotInventory(start: string, end: string, teacherId?: string): Promise<SlotInventory[]>` — approx. 1091–1208. Reads from `AIRTABLE_CONFIG.tables.slot_inventory` (`config/airtable.ts`). Uses `contracts/fieldMap.ts` via `getField('slotInventory', ...)` for תאריך_שיעור, מורה, שעת_התחלה, שעת_סיום, סטטוס, etc. Returns records mapped to `SlotInventory` plus extra fields (`naturalKey`, `lessonDate`, `sourceWeeklySlot`, `dayOfWeek`, `startDT`, `endDT`, `isFull`, `isBlock`, `isLocked`).

- **Weekly slots**
  - `getWeeklySlots(teacherId?: string)` and other weekly_slot APIs are delegated to `slotManagementService` (see imports line 9).

There is **no** `getOpenSlots` in `nexusApi`. “Open slots” are:
- Fetched as slot_inventory, then filtered by `status === 'open'`.
- Exposed as `OpenSlot[]` via `data/hooks/useOpenSlots.ts`, which uses `useSlotInventory` and converts `SlotInventory[]` to `OpenSlot[]` (with `startDateTime`/`endDateTime`) for the requested range.

So for the calendar, you can either:
- Use `nexusApi.getSlotInventory(startDate, endDateStr)` and in the UI filter `status === 'open'` and optionally map to a display/overlap format, or
- Use `data/hooks/useSlotInventory` / `useOpenSlots` with the same range the calendar uses for lessons.

### Other relevant layers

- `data/resources/slotInventory.ts`: `getSlotInventory(range, teacherId?)` → `nexusApi.getSlotInventory(start, end, teacherId)` with cache.
- `services/slotManagementService.ts`: alternative `getSlotInventory(startDate, endDate)` and other slot_inventory/weekly_slot logic.

---

## 3) Where Lesson Create/Update Happens

### UI

- **File:** `components/Calendar.tsx`
  - **Create:** `handleSlotClick(date, hour)` (line 301) opens the create form; `handleSave` (line 198) runs on “צור שיעור”. For create, it calls `nexusApi.createLesson({...})` (line 259).
  - **Update:** When `selectedLesson` is set, `handleSave` calls `nexusApi.updateLesson(selectedLesson.id, {...})` (line 251).
  - **Conflict UX:** Uses `checkConflicts` (debounced) and `nexusApi.checkLessonConflicts`. If `conflicts.length > 0`, save is **blocked** and an alert is shown (lines 227–234). There is no slot-overlap check and no `SlotOverlapModal` in this flow.

### Service

- **Create:** `services/nexusApi.ts` — `createLesson` (approx. 2189–2594). Validates, converts local time to UTC, does lesson-vs-lesson conflict check, then creates the Airtable record.
- **Update:** `services/nexusApi.ts` — `updateLesson` (approx. 1671+). Maps fields and writes to Airtable.

Lesson create/update do **not** currently query or consider slot_inventory.

---

## 4) Date Range and Timezone

### Week/day range in the calendar

- **File:** `components/Calendar.tsx`
- **Computation:** `weekDates` useMemo (lines 32–42):
  - `firstDay = new Date(currentDate); firstDay.setDate(currentDate.getDate() - currentDate.getDay())` → Sunday of the same week in **local** time.
  - Array of 7 dates (Sun–Sat) built from that.
- **Strings passed to API:**  
  `startDate = weekDates[0].toISOString().split('T')[0]`  
  `endDateStr = weekDates[6].toISOString().split('T')[0]`  
  (lines 47–48).

**Timezone caveat:** `toISOString()` is UTC. For a user in Israel (UTC+2/3), the “date” part can be one day off near midnight. For example, Sunday 02:00 Israel time is still Saturday in UTC, so `weekDates[0].toISOString().split('T')[0]` can be Saturday’s date. Any fix should use local-date formatting for week boundaries (e.g. `formatDate(weekDates[0])` from `services/dateUtils.ts` or equivalent) when talking to the API.

### Conflict check (lesson-vs-lesson)

- **File:** `components/Calendar.tsx`, `checkConflicts` (lines 88–138).
- Builds `localStartDatetime = \`${date}T${startTime}:00\``, then `startDate = new Date(localStartDatetime)`, then `startDatetime = startDate.toISOString()` (and similarly for end). So the UI treats `date`/`startTime` as **local**, then sends **UTC** ISO strings to `nexusApi.checkLessonConflicts`.

### Utilities

- **File:** `services/dateUtils.ts`  
  - `getWeekStart(date)` — Sunday 00:00 local.  
  - `formatDate(date)` — `YYYY-MM-DD` in local time.  
  - No timezone conversion helpers.

---

## 5) Files to Edit (Exact Paths)

| # | File | Role |
|---|------|------|
| 1 | `components/Calendar.tsx` | Add slot_inventory load, merge open slots into grid/agenda with distinct style, wire overlap check and SlotOverlapModal into create/update. |
| 2 | `services/overlapDetection.ts` | **Implement** `hasOverlap` and `findOverlappingOpenSlots` (file exists but is **empty**; tests in `overlapDetection.test.ts` expect these). |
| 3 | `components/ui/SlotOverlapModal.tsx` | **Use** — already implemented; wire into Calendar for lesson create/update when overlapping open slots. |
| 4 | `services/nexusApi.ts` | Optional: add something like `checkSlotInventoryOverlaps(startDatetime, endDatetime, teacherId?)` if overlap must be server-side; otherwise client-only overlap is enough. |
| 5 | `types.ts` | Optional: add optional `startDT`/`endDT` (or similar) on a widened slot type for overlap; current `SlotInventory` plus API return shape may already suffice. |
| 6 | `services/dateUtils.ts` | Optional: use local-date week boundaries in Calendar (e.g. `formatDate(weekDates[0])`) instead of `toISOString().split('T')[0]` to avoid timezone-off-by-one at week edges. |

The critical code changes are in **Calendar.tsx**, **overlapDetection.ts**, and wiring **SlotOverlapModal** into the save flow.

---

## 6) Existing Types Relevant to Lessons and Calendar

From `types.ts`:

```ts
// Lessons
interface Lesson {
  id: string;
  studentId: string;
  studentIds?: string[];
  studentName: string;
  teacherId?: string;
  teacherName?: string;
  date: string;           // 'YYYY-MM-DD'
  startTime: string;      // 'HH:MM'
  duration: number;
  status: LessonStatus;
  subject: string;
  isChargeable: boolean;
  chargeReason?: string;
  isPrivate: boolean;
  lessonType?: LessonType;
  notes?: string;
  // ... payment, price, etc.
}

// Slot inventory (minimal in types.ts)
interface SlotInventory {
  id: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'open' | 'booked' | 'blocked';
}

// Open slots (datetime-based, used by overlap/display)
interface OpenSlot {
  id: string;
  teacherId: string;
  teacherName?: string;
  startDateTime: string;  // ISO
  endDateTime: string;    // ISO
  status: 'open' | 'booked' | 'blocked';
  source?: string;
}
```

`CalendarWeekView` uses a local type:

```ts
// components/CalendarWeekView.tsx
type CalendarEvent = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title?: string;
  subtitle?: string;
  teacherName?: string;
  type?: string;
  status?: string;
  color?: string;
  borderColor?: string;
  notes?: string;
};
```

Calendar.tsx does not use `CalendarEvent`; it renders `Lesson` (and in the future, slot_inventory) directly in its inline grid.

---

## 7) Proposed Types for SlotInventory / Overlap

- **Keep** `SlotInventory` and `OpenSlot` in `types.ts` as-is for domain use.
- **Option A (minimal):** Use `SlotInventory` plus the extra fields the API already returns (`startDT`, `endDT`, etc.) as a separate extended type or inline cast where needed for overlap (e.g. in `findOverlappingOpenSlots`). No new exported type required.
- **Option B (explicit):** Add an extended type for “slot inventory as returned by the API / used in overlap”:

```ts
// Optional: for overlap and display when API returns startDT/endDT
export type SlotInventoryWithDT = SlotInventory & {
  startDT?: string;   // ISO datetime
  endDT?: string;    // ISO datetime
};
```

- **Overlap API:** `findOverlappingOpenSlots(lessonDraft, openSlotsOrInventory)` can accept `(OpenSlot | SlotInventory)[]` and, for `SlotInventory`, derive windows from `startDT`/`endDT` when present, else from `date` + `startTime`/`endTime` (as in `overlapDetection.test.ts`). So **proposed new types** are optional; the main need is implementing the overlap functions to handle both shapes.

---

## 8) Step-by-Step Execution Plan (Max 12 Steps)

**Phase A – Overlap and modal readiness**

1. **Implement `services/overlapDetection.ts`**  
   - Add `hasOverlap(aStart, aEnd, bStart, bEnd)` (string or Date; treat boundaries as exclusive for “touching” as in tests).  
   - Add `findOverlappingOpenSlots(lessonDraft: { date, startTime, duration, teacherId? }, slots: (OpenSlot|SlotInventory)[])`.  
   - For each slot: if it has `startDateTime`/`endDateTime` (OpenSlot) use them; else build from `date`+`startTime`/`endTime` (and optional `startDT`/`endDT` on SlotInventory). Filter by `status === 'open'` and optional `teacherId`. Return overlapping slots.

2. **Wire SlotOverlapModal into Calendar**  
   - In `components/Calendar.tsx`, import `SlotOverlapModal` and add state: e.g. `showSlotOverlapModal`, `overlappingSlots: (OpenSlot|SlotInventory)[]`.  
   - When user clicks save (create/update), **before** calling create/update: compute lesson window from `editState`; call `findOverlappingOpenSlots(editState, openSlotsOrSlotInventory)`. If non-empty, set `overlappingSlots` and `showSlotOverlapModal = true` and **do not** call API yet.  
   - Render `SlotOverlapModal` when `showSlotOverlapModal`; `onAction('save_anyway')` → perform create/update and close modal; `onAction('cancel')` → close modal and abort save. Use existing `onAction`/`onCancel` contract of `SlotOverlapModal`.

**Phase B – Load and show open slots on the calendar**

3. **Load slot_inventory in Calendar**  
   - In `components/Calendar.tsx`, in the same `useEffect` that fetches lessons (or in a parallel fetch), call `nexusApi.getSlotInventory(startDate, endDateStr)` (and optionally pass a `teacherId` when a teacher filter exists).  
   - Store result in state, e.g. `slotInventory: SlotInventory[]`, or use `useSlotInventory({ start: startDate, end: endDateStr })` from `data/hooks/useSlotInventory.ts` and use that as the source for both display and overlap.

4. **Derive “open” slots for display and overlap**  
   - In Calendar, from `slotInventory`, keep only `status === 'open'` and (optionally) same date range as the week. Use this list both for rendering and as the argument to `findOverlappingOpenSlots` in the save flow.

5. **Render open slots in the week/day grid with a distinct style**  
   - In the week/day block (lines 401–434), besides `filteredLessons`, iterate over the open-slot list. For each, compute `topOffset` and `height` from `date`/`startTime`/`endTime` (same logic as lessons, or use `startDT`/`endDT` if available).  
   - Render a non-interactive or low-interaction block (e.g. “חלון פתוח”) with distinct styling: e.g. dashed border, lighter background, lower z-index than lessons, so lessons draw on top.

6. **(Optional) Show open slots in agenda view**  
   - In the agenda branch (lines 361–385), add a section or merged list for open slots per day with the same distinct style and “חלון פתוח” label.

**Phase C – Save flow and overlap modal behavior**

7. **Use open-slots list in the save path**  
   - Ensure the same “open slots” list used for rendering is passed to `findOverlappingOpenSlots` in the save path. If the list comes from the same fetch/hook as in steps 3–4, no extra fetch is needed.

8. **Keep modal non-blocking**  
   - Do not block create/update when there are only slot overlaps (only lesson-vs-lesson conflicts stay blocking). When there are slot overlaps, show SlotOverlapModal; “save anyway” triggers the same create/update logic that would run without the modal.

9. **Optional: “Save and close slot”**  
   - If SlotOverlapModal’s `onAction('save_and_close')` or `'reserve_slot'` should be supported, add a step: on that action, after creating/updating the lesson, call an API to update the overlapping slot_inventory (e.g. set status to `booked` or link to lesson). This may require a small API in `nexusApi` or `slotManagementService`. Defer to a follow-up if not in scope.

**Phase D – Consistency and robustness**

10. **Align date range with local time**  
    - In `components/Calendar.tsx`, replace `startDate = weekDates[0].toISOString().split('T')[0]` (and same for `endDateStr`) with `formatDate(weekDates[0])` / `formatDate(weekDates[6])` from `services/dateUtils.ts` (or equivalent local-date formatting) so the requested range always matches the user’s week in Israel.

11. **Refresh data after create/update**  
    - After a successful create/update (and optionally after “save and close slot”), refresh lessons and slot_inventory for the current week so the grid and overlap list stay in sync.

12. **Manual check**  
    - Create a lesson whose time overlaps an open slot_inventory window → SlotOverlapModal appears → “המשך בכל זאת” creates the lesson and closes the modal; “ביטול” leaves the form open and does not call the API.

---

## 9) Summary Table

| Topic | Location / finding |
|-------|---------------------|
| Calendar UI | `components/Calendar.tsx`; inline week/day/agenda; no CalendarWeekView |
| getLessons call site (calendar) | `components/Calendar.tsx` lines 56, 301 — `nexusApi.getLessons(startDate, endDateStr)` |
| Lessons API | `services/nexusApi.ts`: getLessons, createLesson, updateLesson, checkLessonConflicts |
| Slot inventory API | `services/nexusApi.ts`: getSlotInventory(start, end, teacherId?) |
| Lesson create/update UI | `components/Calendar.tsx`: handleSave → createLesson / updateLesson |
| Lesson create/update API | `services/nexusApi.ts`: createLesson, updateLesson |
| Week range | `components/Calendar.tsx`: weekDates (Sun–Sat), then toISOString().split('T')[0] — prefer local-date formatting |
| Overlap utility | `services/overlapDetection.ts` — **empty**; must implement hasOverlap + findOverlappingOpenSlots |
| Overlap modal | `components/ui/SlotOverlapModal.tsx` — exists, not used; wire into Calendar save flow |
| Types | `types.ts`: Lesson, SlotInventory, OpenSlot; optional SlotInventoryWithDT for overlap |

This completes the audit and the execution plan. Implementation can follow the 12 steps above in order.
