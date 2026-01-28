# Overlap Detection Utility

## Summary

Created a shared overlap detection utility used by both lesson-save and slot-save flows. The utility provides reusable functions for detecting time overlaps between lessons and open slots.

## Files Created

1. **`services/overlapDetection.ts`** - Main utility module
2. **`services/overlapDetection.test.ts`** - Jest unit tests

## Functions

### `hasOverlap(aStart, aEnd, bStart, bEnd): boolean`

Checks if two time ranges overlap using the rule: `aStart < bEnd && aEnd > bStart`

**Parameters:**
- `aStart`: Start time of range A (ISO datetime string or Date)
- `aEnd`: End time of range A (ISO datetime string or Date)
- `bStart`: Start time of range B (ISO datetime string or Date)
- `bEnd`: End time of range B (ISO datetime string or Date)

**Returns:** `true` if ranges overlap, `false` otherwise

**Features:**
- Accepts both ISO datetime strings and Date objects
- Handles mixed input types (string + Date)
- Edge case: Zero-duration ranges don't overlap

**Example:**
```typescript
hasOverlap(
  '2024-01-15T10:00:00Z',
  '2024-01-15T11:00:00Z',
  '2024-01-15T10:30:00Z',
  '2024-01-15T11:30:00Z'
); // Returns true
```

### `findOverlappingOpenSlots(lessonDraft, openSlots): (OpenSlot | SlotInventory)[]`

Finds open slots that overlap with a lesson draft.

**Parameters:**
- `lessonDraft`: Partial lesson with required fields:
  - `date`: string (YYYY-MM-DD)
  - `startTime`: string (HH:MM)
  - `duration`: number (minutes)
  - `teacherId?`: string (optional, filters by teacher if provided)
- `openSlots`: Array of `OpenSlot` or `SlotInventory` objects

**Returns:** Array of overlapping open slots

**Filtering Logic:**
1. **Status filter**: Only slots with `status === "open"` are considered
2. **Teacher filter**: If `lessonDraft.teacherId` is provided, only slots with matching `teacherId` are considered
3. **Time overlap**: Uses `hasOverlap()` to check if lesson time range overlaps with slot time range

**Handles Both Types:**
- **OpenSlot**: Uses `startDateTime` and `endDateTime` (ISO strings)
- **SlotInventory**: Constructs ISO strings from `date + startTime/endTime`

**Example:**
```typescript
const lessonDraft = {
  date: '2024-01-15',
  startTime: '10:30',
  duration: 30,
  teacherId: 'teacher1',
};

const overlaps = findOverlappingOpenSlots(lessonDraft, openSlots);
// Returns array of OpenSlot or SlotInventory that overlap
```

## DEV-Only Self-Check

The utility includes a DEV-only self-check that runs automatically when the module is imported in development mode. It tests:

1. ✓ Overlapping ranges detection
2. ✓ Non-overlapping ranges detection
3. ✓ Adjacent ranges (no overlap)
4. ✓ Contained range (overlap)
5. ✓ `findOverlappingOpenSlots` with OpenSlot type
6. ✓ Teacher ID filtering
7. ✓ Status filtering

The self-check logs results to console and warns if any tests fail.

## Unit Tests

Jest test suite (`overlapDetection.test.ts`) includes:

### `hasOverlap` Tests:
- Overlapping ranges
- Non-overlapping ranges
- Adjacent ranges (touching)
- Contained ranges
- Date object inputs
- Mixed string/Date inputs
- Edge case: zero-duration ranges

### `findOverlappingOpenSlots` Tests:
- Finding overlaps with OpenSlot type
- Finding overlaps with SlotInventory type
- Teacher ID filtering
- Status filtering (only "open")
- No overlaps case
- Missing required fields handling
- No teacherId filter (when lesson has no teacherId)
- Multiple overlapping slots

## Usage in Codebase

### For Lesson-Save Flow:
```typescript
import { findOverlappingOpenSlots } from '../services/overlapDetection';

const lessonDraft = {
  date: editState.date!,
  startTime: editState.startTime!,
  duration: editState.duration || 60,
  teacherId: editState.teacherId,
};

const overlappingSlots = findOverlappingOpenSlots(lessonDraft, openSlots);
if (overlappingSlots.length > 0) {
  // Show warning/confirmation
}
```

### For Slot-Save Flow:
```typescript
import { hasOverlap } from '../services/overlapDetection';

const slotStart = new Date(`${slot.date}T${slot.startTime}:00`);
const slotEnd = new Date(`${slot.date}T${slot.endTime}:00`);
const lessonStart = new Date(`${lesson.date}T${lesson.startTime}:00`);
const lessonEnd = new Date(lessonStart.getTime() + lesson.duration * 60 * 1000);

if (hasOverlap(slotStart, slotEnd, lessonStart, lessonEnd)) {
  // Handle overlap
}
```

## Testing

Run tests with:
```bash
npm test overlapDetection.test.ts
```

Or run all tests:
```bash
npm test
```

## Notes

- The utility is timezone-aware: it converts ISO datetime strings to timestamps for comparison
- For `SlotInventory`, the utility constructs ISO datetime strings assuming local timezone
- The overlap rule (`aStart < bEnd && aEnd > bStart`) is the standard interval overlap check
- Adjacent ranges (touching) are considered non-overlapping
