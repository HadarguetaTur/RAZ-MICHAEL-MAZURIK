# Calendar Open Slots Implementation

## Summary

Updated the Calendar component to fetch and render open slots from `slot_inventory` alongside lessons in a unified view.

## Implementation Details

### Files Modified

1. **`components/Calendar.tsx`**
   - Added `OpenSlot` import
   - Created `CalendarItem` unified type
   - Added `openSlots` state
   - Updated data fetching to call both `getLessons()` and `getOpenSlots()`
   - Created `calendarItems` unified array combining lessons and open slots
   - Updated rendering logic for both agenda and week/day views

### Key Changes

#### 1. Type Definition (Lines 15-30)
```typescript
type CalendarItem = {
  kind: 'lesson' | 'open_slot';
  id: string;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  duration: number; // minutes
  teacherId?: string;
  title: string;
  meta?: {
    lesson?: Lesson;
    openSlot?: OpenSlot;
    [key: string]: any;
  };
};
```

#### 2. Data Fetching (Lines 59-82)
- Added `openSlots` state
- Updated `useEffect` to fetch both lessons and open slots in parallel
- Converts date range to ISO datetime strings for `getOpenSlots()`

#### 3. Unified Array Creation (Lines 125-170)
- `calendarItems` useMemo combines filtered lessons and open slots
- Converts OpenSlot ISO datetime strings to local date/time
- Preserves original lesson and slot data in `meta` field

#### 4. Rendering Updates

**Agenda View (Lines 410-490):**
- Filters `calendarItems` by date
- Renders lessons with existing styling (unchanged)
- Renders open slots with distinct styling

**Week/Day View (Lines 520-600):**
- Filters `calendarItems` by date
- Renders lessons with existing styling (unchanged, z-index: 5)
- Renders open slots with distinct styling (z-index: 1, behind lessons)

## Styling Details

### Open Slots Visual Style (Tailwind CSS)

**Agenda View:**
- Background: `bg-slate-50/50` (light gray, semi-transparent)
- Border: `border-2 border-dashed border-slate-300` (dashed, gray)
- Time badge: `bg-slate-100 text-slate-600 border border-slate-200`
- Status tag: `bg-slate-100 text-slate-600 border-slate-300` with "חלון פתוח" text

**Week/Day View:**
- Background: `bg-slate-50/70` (light gray, more opaque)
- Border: `border-2 border-dashed border-slate-300` (dashed, gray)
- Position: Absolute positioning with calculated `top` and `height`
- Z-index: `z-1` (renders behind lessons which have `z-5`)
- Status tag: `bg-slate-200 text-slate-600 border border-slate-300` with "חלון פתוח" text

### Lessons (Unchanged)
- Background: `bg-white`
- Border: Solid, colored by lesson type (blue/amber/indigo)
- Z-index: `z-5` (renders above open slots)

## Expected Visual Behavior

### Week/Day View
1. **Open slots appear as dashed-border blocks** with light gray background
2. **Lessons appear as solid-border blocks** with white background
3. **When overlapping**: Lessons render on top (higher z-index)
4. **Time positioning**: Both use same calculation (hour * 96px + minutes/60 * 96px)
5. **Height calculation**: Both use duration in minutes converted to pixels

### Agenda View
1. **Open slots appear as list items** with dashed border and light background
2. **Lessons appear as list items** with solid border and white background
3. **Both sorted by time** within each day
4. **Open slots show "חלון פתוח" tag** on the right side

### Visual Distinction
- **Open slots**: Dashed border, light gray background, subtle appearance
- **Lessons**: Solid border, white background, prominent appearance
- **Status label**: Open slots always show "חלון פתוח" tag

## Performance

- **No extra requests**: Only 2 API calls per date range (getLessons + getOpenSlots)
- **Efficient filtering**: Uses useMemo for calendarItems array
- **Minimal re-renders**: CalendarItems only recalculates when lessons or openSlots change

## Timezone Handling

- Open slots use ISO datetime strings (may be UTC)
- Conversion to local time happens in `calendarItems` useMemo
- Uses `getHours()` and `getMinutes()` for local time display
- Date extraction uses `getFullYear()`, `getMonth()`, `getDate()` for local date

## Testing Checklist

- [x] Open slots load and display on calendar
- [x] Open slots render with distinct styling (dashed border, light background)
- [x] Open slots appear in correct day/time columns
- [x] Lessons remain unchanged in appearance and behavior
- [x] When overlapping, lessons render on top
- [x] Both agenda and week/day views show open slots
- [x] Timezone conversion works correctly
- [x] No performance degradation (only 2 API calls)
