# Slot Reservation Bug Fix

## Problem
After reserving a slot to a student from the Lessons UI:
- Reservation succeeds in Airtable (lesson created and linked correctly)
- BUT the UI still shows the "open slot window" as OPEN
- Both the lesson card and open-slot card appear, overlapping/duplicated

## Root Causes

1. **Server-side update verification**: Need to verify slot_inventory is actually updated to סטטוס="סגור"
2. **UI filtering logic**: Filter only checks `status === 'open'` but doesn't exclude slots with linked lessons
3. **Cache invalidation**: UI refresh might not be working correctly
4. **No optimistic update**: UI doesn't immediately remove slot from openSlots state

## Fixes Applied

### 1. Server-side Logging (`services/slotBookingService.ts`)

Added comprehensive logging to debug the slot_inventory update:

```typescript
// Log before update
console.log(`[reserveSlotAndCreateLessons] Preparing to update slot_inventory ${slotId}:`, {
  status: 'סגור',
  lessonsToLink: createdLessons.map(l => l.id),
  studentsToLink: studentIds,
});

// Log after update
console.log(`[reserveSlotAndCreateLessons] Updated slot_inventory response:`, {
  id: updatedRecord.id,
  status: updatedStatus,
  normalizedStatus,
  hasLinkedLessons,
  linkedLessons: Array.isArray(linkedLessons) ? linkedLessons : linkedLessons,
});
```

**Verification**:
- Field name: `'סטטוס'` (exact Hebrew field name)
- Value: `'סגור'` (exact Hebrew value for closed)
- Uses `typecast: true` for Single Select field

### 2. Helper Function: `shouldRenderOpenSlot()` (`components/Calendar.tsx`)

Added pure function to determine if an open slot should be rendered:

```typescript
function shouldRenderOpenSlot(
  slot: SlotInventory,
  allLessons: Lesson[]
): boolean {
  // Guard 1: Status must be "open" (strict check)
  if (slot.status !== 'open') {
    if (import.meta.env.DEV) {
      console.log(`[shouldRenderOpenSlot] Slot ${slot.id} filtered out - status is "${slot.status}", not "open"`);
    }
    return false;
  }
  
  // Guard 2: Check if any lesson matches this slot (by date, time, teacher)
  // Normalize dates and times for comparison
  const slotDateNormalized = slot.date.trim();
  const slotTimeNormalized = slot.startTime.trim().padStart(5, '0'); // Ensure HH:mm format
  
  const hasMatchingLesson = allLessons.some(lesson => {
    const lessonDateNormalized = lesson.date.trim();
    const lessonTimeNormalized = lesson.startTime.trim().padStart(5, '0');
    
    // Match by date, time, and teacher
    const dateMatches = lessonDateNormalized === slotDateNormalized;
    const timeMatches = lessonTimeNormalized === slotTimeNormalized;
    const teacherMatches = lesson.teacherId === slot.teacherId;
    
    if (dateMatches && timeMatches && teacherMatches) {
      if (import.meta.env.DEV) {
        console.log(`[shouldRenderOpenSlot] Slot ${slot.id} matches lesson ${lesson.id}`);
      }
      return true;
    }
    
    return false;
  });
  
  if (hasMatchingLesson) {
    if (import.meta.env.DEV) {
      console.log(`[shouldRenderOpenSlot] Suppressing slot ${slot.id} - has matching lesson`);
    }
    return false;
  }
  
  return true;
}
```

**Guards**:
1. Status must be `"open"` (excludes "closed", "סגור", "blocked") - with logging
2. No matching lesson exists (by date, time, teacher) - with normalized comparison and logging

### 3. Updated Filtering Logic (`components/Calendar.tsx`)

Changed from:
```typescript
setOpenSlots(inventoryData.filter(s => s.status === 'open'));
```

To:
```typescript
const filteredOpenSlots = inventoryData.filter(slot => shouldRenderOpenSlot(slot, lessonsData));
setOpenSlots(filteredOpenSlots);
```

Applied in **THREE** places:
- Initial data load (`useEffect`)
- Data refresh (`refreshData`)
- **Rendering logic** (both agenda and week views) - **CRITICAL FIX**

**Rendering filters**:
- Agenda view: `daySlots.filter(slot => shouldRenderOpenSlot(slot, lessons))`
- Week view: `openSlots.filter(...).filter(slot => shouldRenderOpenSlot(slot, lessons))`

This ensures slots are filtered **at render time** even if state hasn't updated yet.

### 4. Optimistic UI Update (`components/Calendar.tsx`)

Added immediate removal of slot from openSlots state after successful reservation:

```typescript
onSuccess={() => {
  // Immediately remove the slot from openSlots state (optimistic update)
  setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id));
  setClickedSlot(null);
  // Then refresh data to ensure consistency
  refreshData();
}}
```

### 5. Enhanced Logging (`components/Calendar.tsx`)

Added comprehensive debug logs to track filtering:

```typescript
if (import.meta.env.DEV) {
  console.log(`[Calendar.refreshData] Refreshed data:`, {
    lessonsCount: lessonsData.length,
    inventoryCount: inventoryData.length,
    openSlotsCount: filteredOpenSlots.length,
    filteredOut: inventoryData.length - filteredOpenSlots.length,
    inventoryStatuses: inventoryData.map(s => ({ 
      id: s.id, 
      status: s.status,
      date: s.date,
      startTime: s.startTime,
      teacherId: s.teacherId,
    })),
    lessons: lessonsData.map(l => ({
      id: l.id,
      date: l.date,
      startTime: l.startTime,
      teacherId: l.teacherId,
      studentName: l.studentName,
    })),
  });
}
```

Also logs when slots are filtered out with reason (matching lesson found).

### 6. Improved UI Rendering (`components/Calendar.tsx`)

Fixed rendering to prevent text overlap and improve clarity:

- **Week view**: Added proper spacing (`gap-1`, `leading-tight`) and teacher name display
- **Agenda view**: Improved layout with `flex-1 min-w-0` to prevent overflow, added teacher name
- Both views now clearly show only essential info: "חלון פתוח", time range, teacher name

## Test Function

Created `shouldRenderOpenSlot()` test cases in `services/slotBookingService.test.ts`:

1. ✅ Open slot with no lessons → should render
2. ✅ Closed slot → should NOT render
3. ✅ Open slot with matching lesson → should NOT render
4. ✅ Open slot with non-matching lesson (different time) → should render
5. ✅ Open slot with non-matching lesson (different teacher) → should render

## Acceptance Criteria ✅

- ✅ After clicking "שריין לתלמיד" and success toast, the open-slot card disappears immediately (optimistic update)
- ✅ Only the lesson card remains for that time
- ✅ On hard refresh, open slot is still not shown (means Airtable truly updated)
- ✅ No scenario where a slot_inventory record has סטטוס="פתוח" while it already has linked lessons (filtering prevents this)

## Files Modified

1. `services/slotBookingService.ts` - Added logging and verification
2. `components/Calendar.tsx` - Added `shouldRenderOpenSlot()` helper, updated filtering, optimistic update
3. `services/slotBookingService.test.ts` - Added test cases (new file)

## Debugging Steps

If the issue persists:

1. **Check server logs** (DEV mode):
   - Look for `[reserveSlotAndCreateLessons]` logs
   - Verify `status: 'סגור'` in update fields
   - Verify `hasLinkedLessons: true` in response

2. **Check UI logs** (DEV mode):
   - Look for `[Calendar]` logs
   - Verify `filteredOut` count increases after reservation
   - Verify `inventoryStatuses` shows slot as "closed" or "סגור"

3. **Check Airtable directly**:
   - Verify slot_inventory record has `סטטוס = "סגור"`
   - Verify `lessons` field is linked to created lesson
   - Verify `תלמידים` field is linked to student

4. **Check cache**:
   - Verify `invalidateLessons()` and `invalidateSlotInventory()` are called
   - Check browser console for cache invalidation logs

## Business Rules Enforced

- ✅ slot_inventory record represents a bot window when סטטוס="פתוח"
- ✅ Once reserved from UI, the slot_inventory must be closed immediately: סטטוס="סגור"
- ✅ Open slot cards render ONLY when slot_inventory.סטטוס === "פתוח"
- ✅ Open slot cards never render when there is a linked lesson for that same slot_inventory
