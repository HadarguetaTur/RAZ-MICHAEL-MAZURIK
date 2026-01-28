# Execution Plan: Show Slot Inventory on Calendar + Overlap Detection

## Repository Audit Summary

### 1. Calendar UI Components & Data Loading

**Main Calendar Component:**
- **File**: `components/Calendar.tsx` (837 lines)
- **Data Loading**: Lines 59-82
  - Calls `nexusApi.getLessons(startDate, endDateStr)` in `useEffect`
  - Date range computed from `weekDates` (lines 40-50): Sunday to Saturday of current week
  - Format: `YYYY-MM-DD` (extracted via `.toISOString().split('T')[0]`)
  - Stores lessons in `lessons` state (line 17)

**Calendar Week View Component:**
- **File**: `components/CalendarWeekView.tsx` (251 lines)
- **Purpose**: Reusable week/day grid view
- **Props**: Accepts `events: CalendarEvent[]` (lines 6-19)
- **Rendering**: Lines 182-239 - maps events to positioned blocks on grid
- **Used by**: `Calendar.tsx` (not currently), `Availability.tsx` (line 513)

**Current Calendar Rendering:**
- **Week/Day View**: Lines 456-539 in `Calendar.tsx`
  - Renders lessons as positioned blocks (absolute positioning)
  - Uses `filteredLessons` (line 84) filtered by search/status
  - Time slots: 08:00-21:00 (HOURS constant, line 11)

### 2. Airtable Service Layer

**Main API Service:**
- **File**: `services/nexusApi.ts` (2594 lines)
- **getLessons**: Lines 661-858
  - Signature: `getLessons(start: string, end: string, teacherId?: string): Promise<Lesson[]>`
  - Fetches from Airtable `lessons` table
  - Returns `Lesson[]` with attached `rawRecords` Map
  - **Date format**: Expects `YYYY-MM-DD` strings, converts to UTC for Airtable queries

**Slot Inventory API:**
- **File**: `services/nexusApi.ts` (lines 1091-1205)
- **getSlotInventory**: Lines 1091-1205
  - Signature: `getSlotInventory(start: string, end: string, teacherId?: string): Promise<SlotInventory[]>`
  - Fetches from Airtable `slot_inventory` table
  - Filters by date range and optional teacherId
  - Returns `SlotInventory[]` with fields: `id`, `teacherId`, `teacherName`, `date`, `startTime`, `endTime`, `status`

**Slot Management Service:**
- **File**: `services/slotManagementService.ts`
- **getSlotInventory**: Lines 192-214 (alternative implementation)
- Uses `airtableClient` wrapper

### 3. Lesson Create/Update Flow

**Create Lesson:**
- **UI Entry Point**: `components/Calendar.tsx`
  - `handleSlotClick` (line 333): Opens create form
  - `handleSave` (line 278): Validates and calls `performSave`
  - `performSave` (line 210): Calls `nexusApi.createLesson()` (line 245)
  
- **Service**: `services/nexusApi.ts`
  - `createLesson`: Lines 2189-2594
  - Validates required fields, checks conflicts server-side
  - Converts local time to UTC for Airtable
  - Throws `CONFLICT_ERROR` if overlaps detected (line 2404)

**Update Lesson:**
- **UI Entry Point**: `components/Calendar.tsx`
  - `performSave` (line 210): Calls `nexusApi.updateLesson()` (line 234)
  
- **Service**: `services/nexusApi.ts`
  - `updateLesson`: Lines 1671-1690
  - Maps lesson fields to Airtable format
  - Converts local time to UTC

**Conflict Detection:**
- **Existing**: `nexusApi.checkLessonConflicts()` (lines 2076-2186)
  - Checks for overlapping lessons (time-based)
  - Filters by student/teacher if provided
  - Returns `Lesson[]` of conflicts
- **UI Integration**: `Calendar.tsx` lines 97-152
  - Debounced conflict check (500ms) on form changes
  - Shows warning UI (lines 656-674)
  - Blocks save if conflicts exist (line 305)
  - Has override dialog (lines 802-834) - but only for lesson conflicts

### 4. Date Range Computation & Timezone

**Week Calculation:**
- **Location**: `components/Calendar.tsx` lines 40-50
- **Method**: `weekDates` useMemo
  - Gets Sunday of current week: `currentDate.getDate() - currentDate.getDay()`
  - Creates array of 7 dates (Sunday-Saturday)
- **Date Format**: `YYYY-MM-DD` via `.toISOString().split('T')[0]` (lines 56-57)

**Timezone Assumptions:**
- **Local Time Input**: Users enter dates/times in local timezone (Israel, UTC+2/+3)
- **Airtable Storage**: UTC ISO strings (datetime fields)
- **Conversion**: 
  - `Calendar.tsx` line 116: Creates local datetime string
  - Line 121: Converts to UTC via `.toISOString()`
  - `nexusApi.ts` line 354: Same pattern for updates
- **Date-only fields**: Stored as `YYYY-MM-DD` strings (no timezone conversion)

**Date Utilities:**
- **File**: `services/dateUtils.ts`
- Functions: `getWeekStart()`, `formatDate()`, `calculateDuration()`
- No timezone conversion utilities (assumes local time)

### 5. Existing Types & Interfaces

**Relevant Types (from `types.ts`):**
```typescript
interface Lesson {
  id: string;
  studentId: string;
  studentIds?: string[];
  studentName: string;
  teacherId?: string;
  teacherName?: string;
  date: string;           // 'YYYY-MM-DD'
  startTime: string;      // 'HH:MM'
  duration: number;        // minutes
  status: LessonStatus;
  // ... other fields
}

interface SlotInventory {
  id: string;
  teacherId: string;
  teacherName: string;
  date: string;           // 'YYYY-MM-DD'
  startTime: string;      // 'HH:MM'
  endTime: string;        // 'HH:MM'
  status: 'open' | 'booked' | 'blocked';
}

interface CalendarEvent {
  id: string;
  date: string;           // 'YYYY-MM-DD'
  startTime: string;      // 'HH:MM'
  endTime: string;        // 'HH:MM'
  title?: string;
  subtitle?: string;
  teacherName?: string;
  type?: string;
  status?: string;
  color?: string;
  borderColor?: string;
  notes?: string;
}
```

### 6. Proposed New Types

**No new types needed** - `SlotInventory` already exists in `types.ts` (lines 66-74).

**Enhancement to CalendarEvent (optional):**
- Add `sourceType?: 'lesson' | 'slot'` to distinguish rendering
- Or use existing `type` field with value like `'slot_open'`

---

## Step-by-Step Execution Plan (12 Steps)

### Phase 1: Load & Display Slot Inventory (Steps 1-5)

**Step 1: Add slot inventory data loading to Calendar component**
- **File**: `components/Calendar.tsx`
- **Location**: `useEffect` hook (lines 59-82)
- **Action**: 
  - Add `const [slotInventory, setSlotInventory] = useState<SlotInventory[]>([]);` (after line 20)
  - In `fetchData`, add `nexusApi.getSlotInventory(startDate, endDateStr)` to Promise.all
  - Store result in `slotInventory` state
- **Dependencies**: None

**Step 2: Filter slot inventory by date range and status**
- **File**: `components/Calendar.tsx`
- **Location**: After `filteredLessons` useMemo (line 84)
- **Action**:
  - Create `filteredSlotInventory` useMemo
  - Filter by: date within week, status === 'open'
  - Return `SlotInventory[]`
- **Dependencies**: Step 1

**Step 3: Convert slot inventory to CalendarEvent format**
- **File**: `components/Calendar.tsx`
- **Location**: After `filteredSlotInventory` (Step 2)
- **Action**:
  - Create `slotInventoryEvents` useMemo
  - Map `SlotInventory[]` to `CalendarEvent[]`
  - Set `type: 'slot_open'`, `borderColor: 'border-slate-300'` (or custom color)
  - Set `title: 'חריג פתוח'` or similar
- **Dependencies**: Step 2

**Step 4: Merge lessons and slot inventory for rendering**
- **File**: `components/Calendar.tsx`
- **Location**: Before rendering (line 488)
- **Action**:
  - Create `allCalendarEvents` useMemo
  - Combine `filteredLessons` (mapped to CalendarEvent) + `slotInventoryEvents`
  - Ensure lessons render on top (z-index or array order)
- **Dependencies**: Step 3

**Step 5: Update week/day view rendering to use merged events**
- **File**: `components/Calendar.tsx`
- **Location**: Week/day view rendering (lines 488-534)
- **Action**:
  - Replace `filteredLessons.map(...)` with `allCalendarEvents.map(...)`
  - Update styling logic to handle `type === 'slot_open'` differently
  - Use different border color/background for slots (e.g., dashed border, lighter background)
- **Dependencies**: Step 4

### Phase 2: Overlap Detection for Slot Inventory (Steps 6-9)

**Step 6: Create slot inventory overlap check function**
- **File**: `services/nexusApi.ts`
- **Location**: After `checkLessonConflicts` (line 2186)
- **Action**:
  - Add `checkSlotInventoryOverlaps()` function
  - Signature: `(startDatetime: string, endDatetime: string, teacherId?: string): Promise<SlotInventory[]>`
  - Query `slot_inventory` table for overlapping time ranges
  - Filter by status === 'open' and optional teacherId
  - Return overlapping `SlotInventory[]`
- **Dependencies**: None

**Step 7: Integrate slot overlap check into Calendar conflict detection**
- **File**: `components/Calendar.tsx`
- **Location**: `checkConflicts` function (line 97)
- **Action**:
  - Add `const slotOverlaps = await nexusApi.checkSlotInventoryOverlaps(...)` after lesson conflict check
  - Store in new state: `const [slotOverlaps, setSlotOverlaps] = useState<SlotInventory[]>([]);`
  - Combine with `conflicts` for display
- **Dependencies**: Step 6

**Step 8: Update conflict warning UI to show slot overlaps**
- **File**: `components/Calendar.tsx`
- **Location**: Conflict warning section (lines 656-674)
- **Action**:
  - Update warning to show both lesson conflicts and slot overlaps
  - Distinguish visually (e.g., "שיעור חופף" vs "חריג פתוח חופף")
  - Show slot details: date, time, teacher
- **Dependencies**: Step 7

**Step 9: Add non-blocking confirmation modal for slot overlaps**
- **File**: `components/Calendar.tsx`
- **Location**: After conflict override dialog (line 834)
- **Action**:
  - Create new state: `const [showSlotOverlapDialog, setShowSlotOverlapDialog] = useState(false);`
  - Create `SlotOverlapConfirmDialog` component (or reuse `ConfirmDialog` with custom message)
  - Show when `slotOverlaps.length > 0` and user clicks save
  - Options: "המשך בכל זאת" / "ביטול"
  - Non-blocking: User can proceed even if slots overlap
- **Dependencies**: Step 8

### Phase 3: Integration & Polish (Steps 10-12)

**Step 10: Update handleSave to check slot overlaps**
- **File**: `components/Calendar.tsx`
- **Location**: `handleSave` function (line 278)
- **Action**:
  - After checking `conflicts.length > 0`, check `slotOverlaps.length > 0`
  - If slot overlaps exist, show `showSlotOverlapDialog` (non-blocking)
  - Allow save to proceed regardless (just show warning)
- **Dependencies**: Step 9

**Step 11: Update performSave to handle slot overlap override**
- **File**: `components/Calendar.tsx`
- **Location**: `performSave` function (line 210)
- **Action**:
  - Add `overrideSlotOverlaps?: boolean` parameter
  - Pass to `nexusApi.createLesson/updateLesson` if needed (or just log)
  - Clear `slotOverlaps` state after save
- **Dependencies**: Step 10

**Step 12: Test and refine styling**
- **Files**: `components/Calendar.tsx`, CSS/styling
- **Action**:
  - Test slot inventory display on calendar
  - Ensure slots render below lessons (z-index)
  - Verify overlap detection works correctly
  - Test modal appears and doesn't block save
  - Polish visual distinction between lessons and slots
- **Dependencies**: All previous steps

---

## Files to Edit

### Primary Files:
1. **`components/Calendar.tsx`**
   - Add slot inventory state and loading
   - Add overlap detection integration
   - Update rendering to show slots
   - Add confirmation modal

2. **`services/nexusApi.ts`**
   - Add `checkSlotInventoryOverlaps()` function

### Optional Enhancements:
3. **`types.ts`** (if needed)
   - Enhance `CalendarEvent` type with `sourceType` field

4. **`components/CalendarWeekView.tsx`** (if refactoring)
   - Could be used for unified event rendering (currently Calendar.tsx has its own)

---

## Key Implementation Notes

### Timezone Handling:
- Slot inventory dates are `YYYY-MM-DD` strings (no time conversion needed for date filtering)
- For overlap detection, convert `date + startTime` to UTC ISO string (same pattern as lesson conflicts)
- Use existing pattern: `new Date(\`${date}T${startTime}:00\`).toISOString()`

### Visual Styling:
- Slots should be visually distinct from lessons:
  - Lighter background (e.g., `bg-slate-50` vs `bg-white`)
  - Dashed or different border style
  - Lower z-index (render behind lessons)
  - Different border color (e.g., `border-slate-300` vs `border-blue-600`)

### Overlap Detection Logic:
- Time overlap: `slot_start < lesson_end AND slot_end > lesson_start`
- Same date required
- Optional: filter by same teacher
- Only check slots with `status === 'open'`

### Modal Behavior:
- **Non-blocking**: User can always proceed with save
- Show warning but allow "המשך בכל זאת" or just proceed
- Don't throw errors - just inform user

---

## Testing Checklist

- [ ] Slot inventory loads and displays on calendar
- [ ] Slots render with different styling than lessons
- [ ] Slots appear in correct time slots
- [ ] Overlap detection finds overlapping open slots
- [ ] Modal appears when creating lesson that overlaps slot
- [ ] Modal doesn't block save operation
- [ ] User can proceed with save even if slot overlaps
- [ ] Date range computation works correctly (week boundaries)
- [ ] Timezone conversion works for overlap detection
- [ ] Multiple slots on same day render correctly
- [ ] Slots and lessons on same time slot both visible
