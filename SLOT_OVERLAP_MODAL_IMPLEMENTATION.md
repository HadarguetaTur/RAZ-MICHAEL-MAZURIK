# Slot Overlap Modal Implementation

## Summary

Added a non-blocking confirmation modal when creating/updating a lesson that overlaps open slots. The modal allows users to choose how to handle the overlap.

## Files Modified

1. **`components/ui/SlotOverlapModal.tsx`** (NEW)
   - Modal component for slot overlap confirmation
   - Supports multiple overlapping slots with radio selection
   - Four action buttons with distinct behaviors

2. **`components/Calendar.tsx`**
   - Added slot overlap detection in `handleSave()`
   - Added `handleSlotOverlapAction()` to handle modal actions
   - Added `performSaveAndReturnLesson()` for async lesson save
   - Integrated `SlotOverlapModal` component
   - Added state: `slotOverlaps`, `showSlotOverlapModal`

3. **`services/nexusApi.ts`**
   - Added `updateSlotInventoryWithLesson()` method
   - Updates slot status and links lesson ID

## Flow

### 1. User Clicks Save Lesson
- `handleSave()` is called
- Validates required fields
- Checks for lesson conflicts (existing behavior)
- **NEW**: Checks for slot overlaps using `findOverlappingOpenSlots()`
- Uses currently-loaded `openSlots` (no refetch)

### 2. If Overlaps Found
- Opens `SlotOverlapModal`
- Shows list of overlapping slots with time ranges
- If multiple slots: radio selection (defaults to first)

### 3. Modal Actions

#### A) "קבע שיעור בכל זאת" (Save Anyway)
- Closes modal
- Saves lesson normally
- Does nothing with slot

#### B) "קבע שיעור + סגור חלון" (Save + Close Slot)
- Closes modal
- Saves lesson first
- Then updates selected slot:
  - `status = "blocked"` (closed)
  - `lessons = [savedLesson.id]` (links lesson)
- Refreshes open slots
- Shows success toast

#### C) "שריין חלון" (Reserve Slot)
- Updates selected slot:
  - `status = "booked"` (reserved)
- Refreshes open slots
- **Does NOT save lesson**
- Closes modal
- Shows success toast

#### D) "ביטול" (Cancel)
- Closes modal
- No save, no slot update

## Error Handling

- **Lesson save fails**: Reopens modal, shows error toast
- **Slot update fails**: Shows error toast, lesson still saved
- **API errors**: Graceful error messages via toast
- **UI consistency**: Modal state properly managed on errors

## Async Sequence

1. **Save + Close**: Lesson save → Slot update → Refresh open slots
2. **Reserve**: Slot update → Refresh open slots (no lesson save)
3. **Save Anyway**: Lesson save only

All operations are properly awaited and errors are caught.

## API Changes

### New Method: `nexusApi.updateSlotInventoryWithLesson()`

**Signature:**
```typescript
updateSlotInventoryWithLesson(
  id: string,
  updates: { status: 'open' | 'booked' | 'blocked'; linkedLessonId?: string }
): Promise<SlotInventory>
```

**Updates:**
- `status` field (via `סטטוס`)
- `lessons` linked record field (links to lesson)

**Usage:**
```typescript
await nexusApi.updateSlotInventoryWithLesson(slotId, {
  status: 'blocked',
  linkedLessonId: lesson.id,
});
```

## UI Components

### SlotOverlapModal

**Props:**
- `isOpen: boolean`
- `overlappingSlots: (OpenSlot | SlotInventory)[]`
- `onAction: (action, selectedSlotId) => void | Promise<void>`
- `onCancel: () => void`
- `isLoading?: boolean`

**Features:**
- Radio selection for multiple slots
- Time range display (formats both OpenSlot and SlotInventory)
- Teacher name display (if available)
- Four action buttons with distinct styling
- Keyboard support (ESC to cancel)
- Backdrop click to cancel

**Styling:**
- Warning variant (amber colors)
- Responsive design
- Loading states on buttons
- Disabled states when appropriate

## Integration Points

### Overlap Detection
- Uses `findOverlappingOpenSlots()` from `services/overlapDetection.ts`
- Filters by same `teacherId` (if provided)
- Filters by `status === "open"`
- Checks time overlap

### Toast Notifications
- Uses `useToast()` hook
- Success messages for completed actions
- Error messages for failures
- Non-blocking (doesn't prevent UI interaction)

## Testing Checklist

- [x] Modal opens when lesson overlaps open slot
- [x] Multiple overlapping slots show radio selection
- [x] "Save Anyway" saves lesson without touching slot
- [x] "Save + Close" saves lesson and closes slot
- [x] "Reserve Slot" updates slot without saving lesson
- [x] "Cancel" closes modal without saving
- [x] Error handling works correctly
- [x] Toast notifications appear
- [x] Open slots refresh after slot updates
- [x] UI remains consistent on errors
- [x] TypeScript compilation passes

## Notes

- **Status values**: Uses `'blocked'` for closed, `'booked'` for reserved
- **Linked lesson**: Uses `lessons` linked record field
- **No closed_reason field**: Currently not available in Airtable schema
- **Slot refresh**: Refetches open slots after updates to keep UI in sync
- **Non-blocking**: Modal doesn't prevent other UI interactions (ESC, backdrop click)
