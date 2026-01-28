# Slot-Lesson Overlap Warning Implementation

## Summary

Added a non-blocking confirmation modal when editing/creating slot_inventory records that overlap existing lessons. The modal warns users and allows them to proceed or cancel.

## Files Modified

1. **`components/Availability.tsx`**
   - Added `lessons` state to store loaded lessons
   - Added `findOverlappingLessons()` function using `hasOverlap` utility
   - Added overlap detection in `handleSaveSlot()`
   - Added `handleLessonOverlapConfirm()` for modal action
   - Added state: `overlappingLessons`, `showLessonOverlapModal`, `pendingSlotSave`
   - Updated `loadSlotInventory()` to also load lessons in parallel
   - Integrated `ConfirmDialog` component for warning modal

## Flow

### 1. User Edits/Creates Slot
- User changes slot time (date, startTime, endTime) in the slot edit modal
- User clicks "שמור" (Save)

### 2. Overlap Detection
- `handleSaveSlot()` validates time range
- **NEW**: Calls `findOverlappingLessons()` to check for overlaps
- Uses currently-loaded `lessons` (no refetch)
- Filters by same `teacherId` (if slot has teacherId)
- Filters out cancelled lessons
- Checks time overlap using `hasOverlap()` utility

### 3. If Overlaps Found
- Opens `ConfirmDialog` modal with warning
- Title: "קיים שיעור בזמן הזה"
- Shows list of overlapping lessons (up to 5, with "ועוד X" if more)
- Two actions:
  - **"שמור בכל זאת"**: Proceeds with slot save
  - **"ביטול"**: Closes modal, cancels save

### 4. If No Overlaps
- Proceeds with save normally

## Implementation Details

### Data Loading
- `loadSlotInventory()` now loads both slot inventory AND lessons in parallel
- Date range: 30 days ago to 180 days in the future (same for both)
- Lessons are stored in `lessons` state for overlap detection

### Overlap Detection Function
```typescript
findOverlappingLessons(slotDraft: {
  date: string;
  startTime: string;
  endTime: string;
  teacherId?: string;
}): Lesson[]
```

**Filtering Logic:**
1. **Teacher filter**: If `slotDraft.teacherId` is provided, only lessons with matching `teacherId` are considered
2. **Status filter**: Excludes cancelled lessons (`'בוטל'`, `'ממתין לאישור ביטול'`, `'CANCELLED'`, `'PENDING_CANCEL'`)
3. **Time overlap**: Uses `hasOverlap()` utility to check if slot time range overlaps with lesson time range

### Modal Component
- Reuses existing `ConfirmDialog` component
- Variant: `'warning'` (amber colors)
- Shows list of overlapping lessons with:
  - Student name
  - Date and time
  - Duration
- Scrollable list (max-height: 60vh) if many overlaps

### Async Flow
- `handleSaveSlot()` detects overlaps
- If overlaps found: Shows modal, stores save function in `pendingSlotSave`
- User confirms: `handleLessonOverlapConfirm()` calls stored save function
- User cancels: Modal closes, save is cancelled

## Error Handling

- **No network calls**: Uses already-loaded lessons
- **Graceful degradation**: If lessons fail to load, overlap detection simply won't work (no crash)
- **UI consistency**: Modal state properly managed on cancel

## Integration Points

### Overlap Detection Utility
- Uses `hasOverlap()` from `services/overlapDetection.ts`
- Same utility used by lesson-save flow
- Consistent overlap logic across both flows

### Lesson Loading
- Loads lessons when exceptions tab is active
- Same date range as slot inventory (30 days ago to 180 days future)
- Loaded in parallel with slot inventory for efficiency

## Testing Checklist

- [x] Modal opens when slot overlaps existing lesson
- [x] Multiple overlapping lessons show in list
- [x] "Save Anyway" saves slot despite overlap
- [x] "Cancel" closes modal and cancels save
- [x] No overlaps: save proceeds normally
- [x] Teacher filter works correctly
- [x] Cancelled lessons are excluded
- [x] Time overlap detection works correctly
- [x] No extra network calls (uses loaded lessons)
- [x] TypeScript compilation passes

## Notes

- **Create vs Edit**: Currently only handles editing existing slots (when `editingSlot` is not null)
- **Create path**: If creating new slots is added later, overlap detection will work automatically
- **Date range**: Lessons are loaded for a wide range (30 days ago to 180 days future) to cover all possible slot dates
- **Performance**: Loading lessons in parallel with slot inventory adds minimal overhead
- **Non-blocking**: Modal doesn't prevent other UI interactions (ESC, backdrop click)
