# Availability Management – One-time Slots Audit & Plan

## 1) Availability Management screen and routing

| Item | Location |
|------|----------|
| **Screen component** | `components/Availability.tsx` – single component, no child route |
| **Routing entry** | `App.tsx` – `case 'availability': return <Availability />` (lines 33–34) |
| **Nav label** | `components/Layout.tsx` – `{ id: 'availability', label: 'ניהול זמינות' }` (line 18) |

Tabs inside Availability: `activeTab` is `'weekly' | 'exceptions'`. "זמינות שבועי" / "חריגים וחד-פעמי".

---

## 2) Weekly slots UI (day columns + slot cards)

**Two implementations exist; only one is used:**

| Location | Used by Availability? | Description |
|----------|------------------------|-------------|
| **Inline in `Availability.tsx`** | **Yes** (lines 224–251) | Grid `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4`, DAYS_HEBREW column headers, slot cards via local `renderSlotCard` (lines 138–196), "+ הוסף חלון" per column. |
| **`components/WeeklySlotsGrid.tsx`** | **No** | Same layout (7 columns, DAYS_HEBREW, slot cards, optional onAddSlot). Not imported anywhere; only referenced in docs. |

So the “existing” weekly UI that actually renders is the inline block in `Availability.tsx`. The reusable implementation is `WeeklySlotsGrid.tsx`, but it’s unused and slightly diverged (e.g. optional callbacks, `mode?: 'weekly' | 'inventory'`).

Layout details (both places):

- **Columns**: 7 day columns, headers from `DAYS_HEBREW` + “X חלונות”.
- **Slot card**: rounded-2xl, time range, type badge, teacher, reserved student (if fixed), status dot, hover actions (הקפא/הפעל, ערוך, מחק).
- **Add control**: dashed “+ הוסף חלון” button under each column (weekly only).

---

## 3) Data services for weekly_slot and slot_inventory

| Source | Method | Used by |
|--------|--------|---------|
| **weekly_slot** | | |
| `services/nexusApi.ts` | `getWeeklySlots(): Promise<WeeklySlot[]>` (line 861+) | `Availability.tsx` via direct `nexusApi.getWeeklySlots()` |
| `services/slotManagementService.ts` | `getWeeklySlots(): Promise<WeeklySlot[]>` | Called by nexusApi |
| `config/airtable.ts` | `tables.weekly_slot: 'tbloC7G7ixYDMtdK6'` | nexusApi |
| **slot_inventory** | | |
| `services/nexusApi.ts` | `getSlotInventory(start, end, teacherId?): Promise<SlotInventory[]>` (line 1092+) | Not used by Availability today |
| `services/slotManagementService.ts` | `getSlotInventory(startDate, endDate)` | Used by nexusApi |
| `data/resources/slotInventory.ts` | `getSlotInventory(range, teacherId?)` (cached) | e.g. hooks / other features |
| `data/hooks/useSlotInventory.ts` | `useSlotInventory(range, teacherId?)` | Can be used by Availability for one-time tab |
| `config/airtable.ts` | `tables.slot_inventory: 'tblqMt721kMMtRIWm'` | nexusApi |

For the One-time tab, use either `nexusApi.getSlotInventory(start, end)` or `getSlotInventory({ start, end }, teacherId)` / `useSlotInventory({ start, end }, teacherId)` from the data layer.

---

## 4) Types / interfaces

| Type | File | Shape (summary) |
|------|------|------------------|
| **WeeklySlot** | `types.ts` (lines 61–73) | `id`, `teacherId`, `teacherName`, `dayOfWeek` (0–6), `startTime`, `endTime`, `type` ('private'\|'group'\|'pair'), `status` ('active'\|'paused'), `isFixed?`, `reservedFor?`, `durationMin?` |
| **SlotInventory** | `types.ts` (lines 75–83) | `id`, `teacherId`, `teacherName`, `date` (YYYY-MM-DD), `startTime`, `endTime`, `status` ('open'\|'booked'\|'blocked') |
| **WeeklySlotsGridProps** | `components/WeeklySlotsGrid.tsx` (lines 6–14) | `slots: WeeklySlot[]`, `mode?: 'weekly' \| 'inventory'`, `students?`, `onSlotEdit?`, `onSlotDelete?`, `onSlotToggleStatus?`, `onAddSlot?` |

There are no separate exported types for “SlotCard” or “DayColumn”; the grid is implemented with local structure (day columns built from `DAYS_HEBREW`, cards from a `renderSlotCard(slot)`-style function).

`WeeklySlotsGrid` is typed for `WeeklySlot[]` only. For One-time, we need the same visual “slot card + day column” but for `SlotInventory[]`, grouped by date (e.g. by day index 0–6 of a chosen week).

---

## 5) Reuse vs extract

- **Do not add a second, parallel UI:** use one component for both Weekly and One-time.
- **Reuse:** `WeeklySlotsGrid` is the right place for that single implementation. It already has the desired layout; it just isn’t used and isn’t generalised for `SlotInventory`.
- **Extract:** The inline grid + `renderSlotCard` in `Availability.tsx` should be removed and replaced by `WeeklySlotsGrid` for the weekly tab, and the same grid reused for the One-time tab with `slot_inventory` data.

---

## 6) Diff-style implementation plan

### `components/Availability.tsx`

- **Replace inline weekly grid with `WeeklySlotsGrid`:**
  - Import `WeeklySlotsGrid`.
  - For `activeTab === 'weekly'`, remove the inline `grid` (lines 224–251) and the local `renderSlotCard` (lines 138–196).
  - Render instead:  
    `<WeeklySlotsGrid slots={weeklySlots} students={students} onSlotEdit={…} onSlotDelete={…} onSlotToggleStatus={…} onAddSlot={…} />`  
    and wire handlers to existing `handleOpenModal`, `handleDelete`, `handleToggleStatus`, and “add slot” behaviour. Keep loading/error handling and modal as-is.
- **One-time tab content (replace placeholder):**
  - When `activeTab === 'exceptions'` (or a renamed “One-time” tab), show slot_inventory in the same layout:
    - Add state for the displayed week (e.g. `weekStart: string` ISO date, default “this week’s Sunday”).
    - Load data: `nexusApi.getSlotInventory(weekStart, weekEnd)` or `useSlotInventory({ start: weekStart, end: weekEnd })`, with optional teacher filter.
    - Render the same grid layout (7 columns = 7 days of that week). Reuse `WeeklySlotsGrid` by generalising it (see next file) so it accepts `SlotInventory[]` and `mode='onetime'` (or equivalent), and pass `slots={inventoryForWeek}`, `mode="onetime"`, `weekStart={weekStart}`.
  - Wire One-time actions to slot_inventory APIs: e.g. `nexusApi.updateSlotInventory`, `nexusApi.deleteSlotInventory` (or mutations that invalidate cache), and optional create if product requires it. Keep design and spacing identical to the weekly tab.

No change to routing or tab IDs unless you explicitly rename the second tab (e.g. to “חד-פעמי” only); the plan only assumes that the “One-time slots” content lives in the existing second tab.

---

### `components/WeeklySlotsGrid.tsx`

- **Generalise to support both Weekly and One-time (same UI, same layout):**
  - **Props:**  
    - Add `mode: 'weekly' | 'onetime'`.  
    - Allow `slots: WeeklySlot[] | SlotInventory[]` (e.g. union or overload).  
    - When `mode === 'onetime'`, require a `weekStart: string` (ISO date of Sunday) and use it to:
      - Build 7 columns = that week’s Sun–Sat (labels can be “ראשון 12/1” or reuse DAYS_HEBREW; keep same spacing and column structure).
      - Group `SlotInventory[]` by the weekday of `slot.date` in that week (0–6), and show only slots whose `date` falls in [weekStart, weekEnd].
  - **Card rendering:**
    - Use one card layout for both modes.
    - For `WeeklySlot`: keep current content (time, type, teacher, קבוע/reserved student, status dot, הקפא/הפעל, ערוך, מחק).
    - For `SlotInventory`: same card structure; show `startTime–endTime`, `date` (or short date), `teacherName`, `status` (open/booked/blocked). Omit type/isFixed/reserved where not applicable. Reuse the same classes and spacing; only the data source and a few labels differ.
  - **Callbacks:**  
    - Keep `onSlotEdit`, `onSlotDelete`, `onSlotToggleStatus`, `onAddSlot`. For One-time, `onSlotEdit(slot)` / `onSlotDelete(slot)` will receive `SlotInventory`; parent will branch and call slot_inventory APIs. `onSlotToggleStatus` and `onAddSlot` can be optional or no-op for One-time if not in scope.
  - **Types:**  
    - In this file, accept `WeeklySlot | SlotInventory` and use a type guard (e.g. `'dayOfWeek' in slot`) or a discriminative field to branch in `renderSlotCard`. No need for a new shared “SlotCard” interface if the component stays the single place that knows both shapes.
  - Do not change grid structure, column count, or spacing so that both tabs look the same.

---

### `types.ts`

- **No change.** `WeeklySlot` and `SlotInventory` stay as-is. Any “view” type used only inside `WeeklySlotsGrid` can stay local to that file.

---

### `App.tsx`

- **No change.** Routing for `'availability'` already renders `<Availability />`.

---

### `data/resources/slotInventory.ts` / `data/hooks/useSlotInventory.ts`

- **No structural change.** Use existing `getSlotInventory(range, teacherId?)` or `useSlotInventory(range, teacherId?)` when implementing the One-time tab in `Availability.tsx` (e.g. pass `{ start: weekStart, end: weekEnd }`).

---

### `services/nexusApi.ts` / `services/slotManagementService.ts` / `config/airtable.ts`

- **No change.** `getSlotInventory(start, end, teacherId?)` and `slot_inventory` table config are already sufficient for the One-time tab.

---

## Summary table

| File | Change |
|------|--------|
| `components/Availability.tsx` | Use `WeeklySlotsGrid` for weekly tab (remove inline grid + `renderSlotCard`). For One-time tab, replace placeholder with slot_inventory fetch + same grid; add `weekStart` state and wire inventory CRUD. |
| `components/WeeklySlotsGrid.tsx` | Add `mode: 'weekly' \| 'onetime'`, `slots: WeeklySlot[] \| SlotInventory[]`, `weekStart?`. When `onetime`, group by weekday of `slot.date` in `weekStart`’s week; one card layout for both modes with small branching by slot type. |
| `types.ts` | — |
| `App.tsx` | — |
| `data/resources/slotInventory.ts` | — (use as-is) |
| `data/hooks/useSlotInventory.ts` | — (use as-is) |
| `services/nexusApi.ts` | — |
| `config/airtable.ts` | — |

---

## Constraint check

- **No duplicate UI:** One grid component (`WeeklySlotsGrid`) is reused for both Weekly and One-time; the duplicate inline implementation in `Availability.tsx` is removed.
- **Same design and spacing:** Both tabs use the same grid layout and card styling; only data and a few card fields differ by mode.
