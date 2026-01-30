# Slot Inventory Stabilization - Current State Audit

## Part A: Current State Documentation

### 1. Fetching slot_inventory

#### Primary Fetch Locations:
- **`services/nexusApi.ts:getSlotInventory()`** (lines 1227-1378)
  - Fetches from Airtable table `slot_inventory`
  - Uses `listAllAirtableRecords()` for pagination (pageSize: 100)
  - Filters by date range: `{תאריך_שיעור} >= startDate AND <= endDate`
  - Optional teacher filter: `FIND(teacherId, ARRAYJOIN({מורה})) > 0`
  - Sorts by: date ASC, startTime ASC
  - Maps Airtable records to `SlotInventory` objects
  - **No deduplication** - returns array as-is from pagination

- **`data/resources/slotInventory.ts:getSlotInventory()`** (lines 20-43)
  - Wraps `nexusApi.getSlotInventory()` with caching
  - Cache key: `slot_inventory:${weekStart}:${teacherId || 'all'}`
  - TTL: 3 minutes, stale-while-revalidate enabled
  - **No deduplication** - passes through results

- **`data/hooks/useSlotInventory.ts`** (lines 16-49)
  - React hook wrapper
  - Calls `getSlotInventory()` from resources
  - **Not used by Availability.tsx** - Availability calls `nexusApi.getSlotInventory()` directly

- **`components/Availability.tsx:loadInventory()`** (lines 342-358)
  - Calls `nexusApi.getSlotInventory()` directly (bypasses cache layer)
  - Date range: weekStart to weekStart+6 days
  - Sets state: `setSlotInventory(inventory)`
  - **No deduplication** - sets state directly

#### Airtable Fields Used:
- `תאריך_שיעור` (date) - YYYY-MM-DD format
- `שעת_התחלה` (startTime) - HH:MM format
- `שעת_סיום` (endTime) - HH:MM format
- `מורה` (teacher) - Linked Record field (array)
- `סטטוס` (status) - "פתוח" | "סגור" | "חסום ע"י מנהל" | "מבוטל"
- `תפוסה_נוכחית` (occupied) - number
- `קיבולת_כוללת` (capacity) - number
- `תלמידים` (students) - Linked Record array
- `lessons` (lessons) - Linked Record array
- `natural_key` - string
- `נוצר_מתוך` (sourceWeeklySlot) - Linked Record

### 2. Transform/Mapping

#### Mapping Location:
- **`services/nexusApi.ts:getSlotInventory()`** (lines 1270-1374)
  - Maps each Airtable record to `SlotInventory` object
  - Extracts `id` from `record.id` (Airtable record ID)
  - Normalizes status: "פתוח"/"open" → 'open', "סגור"/"closed"/"booked" → 'closed', etc.
  - Extracts teacherId from linked record array
  - **No deduplication by record.id** - processes all records sequentially

### 3. Rendering

#### UI Components:
- **`components/WeeklySlotsGrid.tsx`** (lines 201-213)
  - Renders `SlotInventoryCard` for each slot
  - Uses `key={inventorySlot.id}` ✅ (correct - uses Airtable record ID)
  - Filters slots by date: `slots.filter(s => s.date === dateStr)`
  - Sorts by: `sort((a, b) => a.startTime.localeCompare(b.startTime))`

- **`components/WeeklySlotsGrid.tsx:SlotInventoryCard`** (lines 271-462)
  - Individual card component
  - Shows Edit/Delete/Block buttons
  - Handles click events with `stopPropagation()`

- **`components/Availability.tsx`** (lines 939-999)
  - Passes `slotInventory` state to `WeeklySlotsGrid`
  - Handles `onReserveSlot`, `onSlotDelete`, `onSlotBlock` callbacks

### 4. Open Slot Modal

#### Modal Components:
- **`components/SlotInventoryModal.tsx`** (lines 21-243)
  - Main modal component for reserving/closing slots
  - Accepts `slot` prop OR `slotId` prop
  - If `slotId` provided, fetches slot data from API

- **`hooks/useOpenSlotModal.ts`** (lines 9-98)
  - Shared hook for managing modal state
  - `open(slotId, preloadedSlot?)` - opens modal
  - `close()` - closes modal
  - Fetches slot data if not preloaded

- **`components/Calendar.tsx`** (lines 1386-1407)
  - Uses `useOpenSlotModal()` hook
  - Renders `SlotInventoryModal` when `slotModal.isOpen && slotModal.slotData`

- **`components/Availability.tsx`** (lines 945-956)
  - Uses `useOpenSlotModal()` hook
  - Calls `slotModal.open(slotId, slot)` when reserving slot

### 5. Overlap Validation

#### Existing Overlap Logic:
- **`services/overlapDetection.ts:hasOverlap()`** (lines 16-27)
  - Core overlap math: `aS < bE && aE > bS` (half-open intervals)
  - Boundary `end == start` is NOT overlap ✅

- **`services/conflictValidationService.ts:validateConflicts()`** (lines 43-146)
  - Checks lesson vs open slots (when creating/updating lesson)
  - Returns `conflicts.openSlots` array
  - Filters by same teacher, same date, status='open'

- **`services/conflictValidationService.ts:preventSlotOpeningIfLessonsOverlap()`** (lines 258-294)
  - Checks slot vs lessons (when creating/updating slot_inventory)
  - Returns `{ canOpen: boolean, conflictingLessons: Lesson[] }`
  - Excludes cancelled lessons
  - **Missing self-exclusion** - doesn't exclude `excludeSlotId` parameter ❌

- **`components/Availability.tsx`** (lines 750-823)
  - Checks conflicts before saving slot_inventory
  - Calls `/api/conflicts/check` endpoint
  - Shows blocking error for lesson overlaps
  - Shows warning for slot_inventory overlaps
  - **Missing internal slot_inventory overlap check** ❌

### 6. Potential Duplicate Sources

#### Root Causes to Investigate:
1. **Pagination merging** (`listAllAirtableRecords`)
   - Uses `allRecords.push(...response.records)` - should be safe
   - Uses Airtable `offset` pagination - should not duplicate
   - **Risk: LOW** - Airtable pagination is reliable

2. **Cache layer** (`data/resources/slotInventory.ts`)
   - Cache key based on weekStart + teacherId
   - If week ranges overlap, could fetch same records twice
   - **Risk: MEDIUM** - different cache keys for overlapping ranges

3. **State updates** (`components/Availability.tsx`)
   - `setSlotInventory(inventory)` - replaces entire array ✅
   - Optimistic updates: `setSlotInventory(prev => prev.filter(...))` ✅
   - After delete/block: calls `loadInventory()` again
   - **Risk: LOW** - state replacement is safe

4. **React rendering** (`WeeklySlotsGrid.tsx`)
   - Uses `key={inventorySlot.id}` ✅
   - But if same `id` appears twice in array, React will render both
   - **Risk: HIGH** - if duplicates exist in array, React will render duplicates

5. **Multiple fetch calls**
   - `loadInventory()` called on tab change + week change
   - `useOpenSlotModal` fetches slots independently
   - **Risk: MEDIUM** - could cause race conditions

### 7. Actions (Edit/Delete/Block)

#### Current Implementation:
- **Edit**: `onSlotEdit(slot)` → opens modal in Availability.tsx
- **Delete**: `onSlotDelete(slotId)` → calls `nexusApi.deleteSlotInventory()` → optimistic update → `loadInventory()`
- **Block**: `onSlotBlock(slotId)` → calls `nexusApi.updateSlotInventory({ status: 'חסום ע"י מנהל' })` → optimistic update → `loadInventory()`

#### Issues:
- Block status mapping: sets `status: 'חסום ע"י מנהל'` in Airtable, but normalized to `'blocked'` in mapping
- Need to verify status mapping handles "חסום ע"י מנהל" correctly

---

## Summary

### Files Involved:
- `services/nexusApi.ts` - fetch + mapping
- `data/resources/slotInventory.ts` - caching layer
- `data/hooks/useSlotInventory.ts` - React hook (not used by Availability)
- `components/Availability.tsx` - main UI + state management
- `components/WeeklySlotsGrid.tsx` - rendering
- `components/SlotInventoryModal.tsx` - modal component
- `hooks/useOpenSlotModal.ts` - shared modal hook
- `components/Calendar.tsx` - uses shared modal
- `services/conflictValidationService.ts` - overlap validation
- `services/overlapDetection.ts` - core overlap math

### Key Findings:
1. ✅ React keys are correct (`key={inventorySlot.id}`)
2. ❌ No deduplication in fetch/mapping layer
3. ❌ Missing self-exclusion in `preventSlotOpeningIfLessonsOverlap()`
4. ❌ Missing internal slot_inventory overlap check
5. ⚠️ Status mapping for "חסום ע"י מנהל" needs verification
6. ⚠️ Multiple independent fetch calls could cause race conditions
