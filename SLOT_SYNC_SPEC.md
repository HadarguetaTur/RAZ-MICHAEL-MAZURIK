# Slot Sync Specification
## weekly_slot → slot_inventory Synchronization

---

## A. CURRENT FIELDS MAP

### weekly_slot (Table ID: tbloC7G7ixYDMtdK6)
**Important Fields:**
- `day_of_week` (Select/Single select) - Day of week: 0-6 (0=Sunday)
- `start_time` (Time) - Start time in HH:mm format
- `end_time` (Time) - End time in HH:mm format
- `teacher_id` (Link to מורים) - Teacher linked record (REQUIRED)
- `type` (Single select) - Lesson type: "פרטי", "זוגי", "קבוצתי"
- `duration_min` (Number) - Duration in minutes
- `קבוע` (Checkbox) - Fixed/recurring slot flag
- `reserved_for` (Link to תלמידים) - Student reservation (optional)
- `is_reserved` (Checkbox) - Reservation status
- `slot` (Text) - Slot identifier/name
- `has_overlap` (Checkbox) - Overlap detection flag
- `overlap_with` (Link to weekly_slot) - Reference to overlapping slot
- `overlap_details` (Text) - Overlap description

**Computed Fields (Read-only):**
- `קיבולת` (Formula) - Capacity calculation

### slot_inventory (Table ID: tblqMt721kMMtRIWm)
**Important Fields:**
- `natural_key` (Text) - Primary key: teacherId|YYYY-MM-DD|HH:mm (REQUIRED)
- `מורה` (Link to מורים) - Teacher linked record (REQUIRED) - Use this field instead of deprecated "מזהה מורה" text field
- `תאריך שיעור` (Date) - Lesson date YYYY-MM-DD (REQUIRED)
- `שעת התחלה` (Time) - Start time HH:mm (REQUIRED)
- `שעת סיום` (Time) - End time HH:mm (REQUIRED)
- `סוג שיעור` (Single select) - Lesson type: "פרטי", "זוגי", "קבוצתי"
- `נוצר מתוך` (Link to weekly_slot) - Source template reference
- `סטטוס` (Single select) - Status: "open", "booked", "blocked"
- `קיבולת כוללת` (Number) - Total capacity
- `חדר` (Text) - Room identifier
- `הערות` (Text) - Notes/comments
- `הוחלו חריגות` (Checkbox) - Exceptions applied flag
- `day_of_week` (Number) - Day of week 0-6

**Computed Fields (Read-only):**
- `תפוסה נוכחית` (Rollup) - Current occupancy count
- `is_full` (Formula) - Full capacity flag
- `is_block` (Formula) - Blocked status flag
- `StartDT` (Formula) - Start datetime (ISO format)
- `EndDT` (Formula) - End datetime (ISO format)

**Linked Record Fields:**
- `lessons` (Link to lessons) - Linked lessons
- `תלמידים` (Link to תלמידים) - Linked students (alternative to lessons)

### Duplicated/Ambiguous Fields

**Issue:** The user mentioned "slot_inventory" and "slot_inventory 2" as link fields in weekly_slot.

**Resolution:**
- If both exist, they are likely:
  1. `slot_inventory` - Primary link to slot_inventory records created from this template
  2. `slot_inventory 2` - Secondary link (possibly for exceptions or historical tracking)
- **Treatment:** Use `slot_inventory` as the primary reference. `slot_inventory 2` should be ignored for sync operations unless there's a specific business rule requiring it.
- **Recommendation:** Verify in Airtable which field is actively maintained. If `slot_inventory 2` is unused, consider removing it to avoid confusion.

---

## B. REQUIRED NEW FIELDS

### 1. is_locked (slot_inventory)
- **Table:** slot_inventory
- **Field Name:** `is_locked` (exact)
- **Type:** Checkbox (boolean)
- **Why Needed:** 
  - Prevents automatic sync from overriding manual changes
  - When `is_locked = true`, the sync engine must skip updates to that record
  - Critical for protecting user-edited slots (time changes, capacity overrides, etc.)
- **Default Value:** Unchecked (false)
- **Usage:** Set manually by Raz when a slot needs protection from automatic updates

**Note:** This field has been added to the field map but may need to be created in Airtable if it doesn't exist.

---

## C. SOURCE OF TRUTH RULES

### Fields Copied from weekly_slot → slot_inventory (on CREATE/UPDATE)

**Always Copied (when template exists and inventory is safe to update):**
- `מזהה מורה` ← `teacher_id`
- `שעת התחלה` ← `start_time`
- `שעת סיום` ← `end_time`
- `סוג שיעור` ← `type`
- `נוצר מתוך` ← weekly_slot record ID (link)

**Conditionally Copied:**
- `קיבולת כוללת` ← `קיבולת` (if capacity formula exists in template)
- `day_of_week` ← `day_of_week` (for reference, computed from date)

**Never Copied (slot_inventory controls these):**
- `natural_key` - Generated from teacherId|date|startTime
- `תאריך שיעור` - Determined by sync date range
- `סטטוס` - Managed per-date (can be manually overridden)
- `תפוסה נוכחית` - Rollup from lessons (read-only)
- `lessons` / `תלמידים` - Managed by lesson creation
- `הערות` - Per-date notes
- `הוחלו חריגות` - Exception flag
- `חדר` - Per-date room assignment
- `is_locked` - Protection flag (manual only)

### When weekly_slot is Edited

**Time Changes (start_time or end_time changed):**
- **If inventory has no lessons and not locked:**
  - Deactivate old slot (set `סטטוס` = "blocked")
  - Create new slot with updated time (new natural_key)
- **If inventory has lessons or is locked:**
  - Skip update, log warning
  - Manual intervention required

**Type Changes (type changed):**
- Update `סוג שיעור` in all future safe slots
- Skip if locked or has lessons

**Teacher Changes (teacher_id changed):**
- **If inventory has no lessons and not locked:**
  - Deactivate old slots (wrong teacher)
  - Create new slots with new teacher (new natural_key)
- **If inventory has lessons:**
  - Skip, log error (teacher change with existing lessons is invalid)

**Day of Week Changes:**
- **If inventory has no lessons and not locked:**
  - Deactivate old slots
  - Create new slots on new day
- **If inventory has lessons:**
  - Skip, manual intervention required

### When weekly_slot is Deactivated/Deleted

**Template Deleted:**
- All future inventory slots (where `נוצר מתוך` = deleted template ID):
  - **If no lessons and not locked:** Set `סטטוס` = "blocked"
  - **If has lessons or locked:** Leave unchanged, log warning

**Template Disabled (if status field exists):**
- Same as deleted: deactivate future safe slots only

---

## D. DUPLICATE + OVERLAP PROTECTION

### Natural Key Strategy

**Format:** `{teacherId}|{YYYY-MM-DD}|{HH:mm}`

**Examples:**
- `recABC123|2024-01-15|14:30`
- `recXYZ789|2024-02-20|09:00`

**Computation:**
```
natural_key = teacher_id + "|" + date_string + "|" + start_time
```

**Uniqueness:**
- Natural key is the primary field in slot_inventory
- Airtable enforces uniqueness at database level
- Sync engine checks existence before CREATE
- If duplicate natural_key exists, skip creation and log warning

### Overlap Detection Logic

**Per Teacher + Date:**
1. Group all slot_inventory records by: `מזהה מורה` + `תאריך שיעור`
2. For each group, compare all pairs using `StartDT` and `EndDT` (formula fields)

**Overlap Condition:**
Two slots overlap if:
```
slot1.StartDT < slot2.EndDT AND slot2.StartDT < slot1.EndDT
```

**Edge Cases:**
- If `StartDT`/`EndDT` are missing (formula error), fall back to time string comparison (less accurate)
- Adjacent slots (end = start) are NOT considered overlapping
- Same time slots are considered overlapping

**Conflict Resolution:**
1. **On CREATE:** Check for overlaps before creating
   - If overlap detected: Skip creation, log warning with both slot natural_keys
   - Optionally: Set `has_overlap` flag on weekly_slot template (if exists)
2. **On UPDATE:** Check overlaps after update
   - If overlap created: Revert update, log error
3. **On Manual Edit:** User responsibility (sync doesn't prevent manual overlaps)

**Overlap Flagging:**
- If `has_overlap` field exists in weekly_slot, set it when overlap detected
- Store overlap details in `overlap_details` if available
- Link to overlapping slot in `overlap_with` if field exists

---

## E. DECISION TABLE

| Scenario | Condition Check | Action | Notes |
|----------|----------------|--------|-------|
| **1. Template exists, inventory missing** | `natural_key` not found in slot_inventory | **CREATE** | Generate natural_key, copy all template fields, set `נוצר מתוך` link |
| **2. Template exists, inventory exists and safe** | `natural_key` exists AND `is_locked = false` AND `lessons` empty AND `is_block = false` | **UPDATE** | Update: teacher, times, type, `נוצר מתוך`. Never touch: date, status, notes, lessons |
| **3. Template exists, inventory locked** | `is_locked = true` | **SKIP** | Log: "Skipping locked slot {natural_key}" |
| **4. Template exists, inventory has lessons** | `lessons` field not empty OR `תלמידים` not empty | **SKIP** | Never update slots with existing lessons. Log: "Protected: has lessons" |
| **5. Template exists, inventory blocked** | `is_block = true` (formula) | **SKIP** | Never override blocked slots. Log: "Protected: is_blocked" |
| **6. Template removed, inventory future safe** | Template deleted AND `natural_key` exists AND future date AND safe (not locked, no lessons, not blocked) | **DEACTIVATE** | Set `סטטוס` = "blocked". Keep record for audit. |
| **7. Template removed, inventory has lessons** | Template deleted AND `lessons` not empty | **SKIP** | Never deactivate slots with lessons. Log: "Cannot deactivate: has lessons" |
| **8. Template time changed, inventory safe** | `start_time` or `end_time` changed AND inventory safe | **DEACTIVATE OLD + CREATE NEW** | Old: set `סטטוס` = "blocked". New: create with new natural_key. |
| **9. Template time changed, inventory has lessons** | Time changed AND `lessons` not empty | **SKIP** | Cannot move slot with lessons. Log: "Cannot change time: has lessons" |
| **10. Template teacher changed, inventory safe** | `teacher_id` changed AND inventory safe | **DEACTIVATE OLD + CREATE NEW** | Old: deactivate. New: create with new teacher (new natural_key). |
| **11. Template teacher changed, inventory has lessons** | Teacher changed AND `lessons` not empty | **SKIP + ERROR** | Invalid state. Log error, require manual fix. |
| **12. Template day changed, inventory safe** | `day_of_week` changed AND inventory safe | **DEACTIVATE OLD + CREATE NEW** | Old: deactivate. New: create on new day. |
| **13. Template day changed, inventory has lessons** | Day changed AND `lessons` not empty | **SKIP** | Cannot move day with lessons. Log: "Cannot change day: has lessons" |
| **14. Multiple templates same time** | Two templates same teacher+day+time | **CREATE BOTH** | Both get created. Overlap detection will flag them. |
| **15. Inventory exists, no matching template** | `natural_key` exists but template deleted/disabled | **DEACTIVATE** (if safe) | Only if future date and safe. Past dates left unchanged. |

**Priority Order for Checks:**
1. Check `is_locked` first (highest priority)
2. Check `lessons` / `תלמידים` 
3. Check `is_block`
4. Then proceed with CREATE/UPDATE/DEACTIVATE

---

## F. PSEUDOCODE / ALGORITHM

```
FUNCTION syncSlots(options):
  INPUT: {startDate?, daysAhead?, teacherId?}
  
  // 1. Initialize
  startDate = options.startDate OR today
  daysAhead = options.daysAhead OR 14
  teacherId = options.teacherId OR null
  
  // 2. Calculate date range (from nearest Sunday)
  weekStart = getNearestSunday(startDate)
  endDate = weekStart + daysAhead days
  
  // 3. Load weekly_slot templates
  IF teacherId:
    templates = GET weekly_slot WHERE teacher_id = teacherId
  ELSE:
    templates = GET ALL weekly_slot
  
  activeTemplateIds = SET(templates.map(id))
  
  // 4. Generate expected inventory from templates
  generatedSlots = []
  FOR EACH template IN templates:
    currentDate = weekStart
    WHILE currentDate <= endDate:
      targetDay = getDateForDayOfWeek(currentDate, template.day_of_week)
      IF targetDay <= endDate:
        naturalKey = buildNaturalKey(
          template.teacher_id, 
          formatDate(targetDay), 
          template.start_time
        )
        generatedSlots.ADD({
          naturalKey: naturalKey,
          teacherId: template.teacher_id,
          date: formatDate(targetDay),
          startTime: template.start_time,
          endTime: template.end_time,
          type: template.type,
          createdFrom: template.id
        })
      currentDate = currentDate + 7 days
  
  // 5. Load existing slot_inventory
  filter = "תאריך שיעור >= {weekStart} AND תאריך שיעור <= {endDate}"
  IF teacherId:
    filter = filter + " AND מזהה מורה = {teacherId}"
  
  existingInventory = GET slot_inventory WHERE filter
  
  // 6. Build lookup maps
  existingByKey = MAP(natural_key -> record) FROM existingInventory
  generatedKeys = SET(generatedSlots.map(naturalKey))
  
  // 7. Detect overlaps (per teacher+date)
  overlaps = []
  FOR EACH teacherDateGroup IN groupBy(existingInventory, [teacher, date]):
    FOR EACH pair (slot1, slot2) IN teacherDateGroup:
      IF hasOverlap(slot1.StartDT, slot1.EndDT, slot2.StartDT, slot2.EndDT):
        overlaps.ADD({slot1, slot2})
        LOG WARNING: "Overlap detected: {slot1.naturalKey} vs {slot2.naturalKey}"
  
  // 8. Compute diff
  toCreate = []
  toUpdate = []
  toDeactivate = []
  
  // 8a. Find slots to create
  FOR EACH gen IN generatedSlots:
    IF gen.naturalKey NOT IN existingByKey:
      toCreate.ADD(gen)
  
  // 8b. Find slots to update
  FOR EACH gen IN generatedSlots:
    existing = existingByKey[gen.naturalKey]
    IF existing:
      IF isSafeToUpdate(existing):
        IF needsUpdate(existing, gen):
          toUpdate.ADD({existing, gen})
      ELSE:
        LOG: "Skipping protected slot {gen.naturalKey}"
  
  // 8c. Find slots to deactivate (orphaned)
  FOR EACH existing IN existingInventory:
    IF existing.naturalKey NOT IN generatedKeys:
      IF existing.נוצר מתוך NOT IN activeTemplateIds:
        IF isSafeToDeactivate(existing):
          toDeactivate.ADD(existing)
  
  // 9. Execute CREATE
  FOR EACH gen IN toCreate:
    TRY:
      // Check for overlaps before creating
      IF hasOverlapWithExisting(gen, existingInventory):
        LOG WARNING: "Skipping create due to overlap: {gen.naturalKey}"
        CONTINUE
      
      CREATE slot_inventory {
        natural_key: gen.naturalKey,
        מזהה מורה: [gen.teacherId],
        תאריך שיעור: gen.date,
        שעת התחלה: gen.startTime,
        שעת סיום: gen.endTime,
        סוג שיעור: gen.type,
        נוצר מתוך: [gen.createdFrom],
        סטטוס: "open"
      }
      createdCount++
    CATCH error:
      LOG ERROR: "Failed to create {gen.naturalKey}: {error}"
      errors.ADD({slot: gen.naturalKey, error})
  
  // 10. Execute UPDATE
  FOR EACH {existing, gen} IN toUpdate:
    TRY:
      UPDATE slot_inventory[existing.id] {
        מזהה מורה: [gen.teacherId],
        שעת התחלה: gen.startTime,
        שעת סיום: gen.endTime,
        סוג שיעור: gen.type,
        נוצר מתוך: [gen.createdFrom]
        // NOTE: Never update date, status, notes, lessons
      }
      updatedCount++
    CATCH error:
      LOG ERROR: "Failed to update {existing.naturalKey}: {error}"
      errors.ADD({slot: existing.naturalKey, error})
  
  // 11. Execute DEACTIVATE
  FOR EACH existing IN toDeactivate:
    TRY:
      UPDATE slot_inventory[existing.id] {
        סטטוס: "blocked"
      }
      deactivatedCount++
    CATCH error:
      LOG ERROR: "Failed to deactivate {existing.naturalKey}: {error}"
      errors.ADD({slot: existing.naturalKey, error})
  
  // 12. Return results
  RETURN {
    created: createdCount,
    updated: updatedCount,
    deactivated: deactivatedCount,
    errors: errors,
    overlaps: overlaps.length
  }

HELPER FUNCTION isSafeToUpdate(slot):
  IF slot.is_locked = true:
    RETURN false
  IF slot.lessons NOT EMPTY OR slot.תלמידים NOT EMPTY:
    RETURN false
  IF slot.is_block = true:
    RETURN false
  RETURN true

HELPER FUNCTION isSafeToDeactivate(slot):
  // Same as isSafeToUpdate
  RETURN isSafeToUpdate(slot)

HELPER FUNCTION needsUpdate(existing, generated):
  IF existing.מזהה מורה != generated.teacherId:
    RETURN true
  IF existing.שעת התחלה != generated.startTime:
    RETURN true
  IF existing.שעת סיום != generated.endTime:
    RETURN true
  IF existing.סוג שיעור != generated.type:
    RETURN true
  IF existing.נוצר מתוך != generated.createdFrom:
    RETURN true
  RETURN false

HELPER FUNCTION hasOverlap(slot1Start, slot1End, slot2Start, slot2End):
  // Use ISO datetime strings from StartDT/EndDT
  RETURN (slot1Start < slot2End AND slot2Start < slot1End)

HELPER FUNCTION buildNaturalKey(teacherId, dateYmd, startTime):
  RETURN teacherId + "|" + dateYmd + "|" + startTime

HELPER FUNCTION getNearestSunday(date):
  dayOfWeek = date.getDay() // 0=Sunday
  daysToSunday = (7 - dayOfWeek) % 7
  IF daysToSunday == 0 AND date is today:
    RETURN date // Already Sunday
  ELSE:
    RETURN date + daysToSunday days, set to 00:00:00
```

---

## G. MAKE IMPLEMENTATION PLAN

### Current State Analysis

**Existing Make Scenarios:**
1. **Weekly creation of next-week inventory** - Runs weekly, creates slots for upcoming week
2. **Weekly creation of recurring lessons** - Runs weekly, creates lessons from `קבוע` slots

### Proposed Refactored Architecture

### 1. Scheduled Sync (Maintain 14 Days Ahead)

**Trigger:** Schedule (Weekly, Sunday 00:00 or Daily 06:00)

**Make Scenario: "Slot Inventory Sync - Scheduled"**

**Flow:**
```
1. Airtable: Search Records (weekly_slot)
   - Filter: None (get all active templates)
   - Sort: teacher_id, day_of_week, start_time

2. Make: Iterator (for each template)

3. Make: Date Calculation
   - Get current date
   - Calculate nearest Sunday (or use current if Sunday)
   - Calculate end date (Sunday + 14 days)

4. Make: Generate Dates Loop
   - For each template, calculate all dates in range
   - Generate natural_key for each: {teacherId}|{date}|{startTime}

5. Airtable: Search Records (slot_inventory)
   - Filter: 
     - תאריך שיעור >= {startDate}
     - תאריך שיעור <= {endDate}
   - Get: natural_key, מזהה מורה, תאריך שיעור, שעת התחלה, שעת סיום, 
          סוג שיעור, נוצר מתוך, סטטוס, is_locked, lessons, תלמידים, is_block

6. Make: Data Structure Operations
   - Build map: existingByKey[natural_key] = record
   - Build set: generatedKeys = all generated natural_keys
   - Build set: activeTemplateIds = all template IDs

7. Make: Diff Logic
   - toCreate: generatedKeys NOT IN existingByKey
   - toUpdate: generatedKeys IN existingByKey AND isSafeToUpdate
   - toDeactivate: existing NOT IN generatedKeys AND נוצר מתוך NOT IN activeTemplateIds AND isSafeToDeactivate

8. Make: Iterator (toCreate)
   - Airtable: Create Record (slot_inventory)
     - natural_key: {generated.naturalKey}
     - מזהה מורה: [{generated.teacherId}]
     - תאריך שיעור: {generated.date}
     - שעת התחלה: {generated.startTime}
     - שעת סיום: {generated.endTime}
     - סוג שיעור: {generated.type}
     - נוצר מתוך: [{generated.createdFrom}]
     - סטטוס: "open"

9. Make: Iterator (toUpdate)
   - Airtable: Update Record (slot_inventory)
     - Record ID: {existing.id}
     - מזהה מורה: [{generated.teacherId}]
     - שעת התחלה: {generated.startTime}
     - שעת סיום: {generated.endTime}
     - סוג שיעור: {generated.type}
     - נוצר מתוך: [{generated.createdFrom}]

10. Make: Iterator (toDeactivate)
    - Airtable: Update Record (slot_inventory)
      - Record ID: {existing.id}
      - סטטוס: "blocked"

11. Make: Webhook/Email (Optional)
    - Send summary: {created} created, {updated} updated, {deactivated} deactivated
```

**Filters:**
- Date range: Nearest Sunday to Sunday + 14 days
- Optional: Filter by teacher_id if needed for testing

**Error Handling:**
- Use Make error handling module
- Log failed operations to Airtable error log table (if exists)
- Continue on individual errors, don't fail entire sync

### 2. On-Change Sync (Template Edits)

**Trigger:** Airtable Webhook (weekly_slot table, on record update/create/delete)

**Make Scenario: "Slot Inventory Sync - On Template Change"**

**Flow:**
```
1. Airtable Webhook: Receive event
   - Event type: create/update/delete
   - Record ID: template record ID
   - Changed fields: (on update)

2. Make: Router
   - IF event = "delete":
     → Go to Deactivation Flow
   - IF event = "create":
     → Go to Creation Flow
   - IF event = "update":
     → Check changed fields
       - IF time/teacher/day changed:
         → Go to Time Change Flow
       - ELSE:
         → Go to Update Flow

3. Creation Flow (new template):
   - Get template record
   - Calculate date range (nearest Sunday + 14 days)
   - Generate slots for this template only
   - Check existing inventory for duplicates
   - Create missing slots

4. Update Flow (template field changed, not time/teacher/day):
   - Get template record
   - Find all inventory where נוצר מתוך = template.id
   - Filter: future dates only, isSafeToUpdate = true
   - Update: type, capacity, etc. (not time/teacher/day)

5. Time Change Flow (start_time/end_time changed):
   - Get template record
   - Find all inventory where נוצר מתוך = template.id
   - Filter: future dates only, isSafeToUpdate = true
   - FOR EACH safe slot:
     - Deactivate old: set סטטוס = "blocked"
     - Create new: with new natural_key (new time)
   - FOR EACH protected slot:
     - Log warning: "Cannot update time, slot has lessons/is_locked"

6. Teacher/Day Change Flow:
   - Similar to Time Change Flow
   - Deactivate old, create new with new natural_key

7. Deactivation Flow (template deleted):
   - Find all inventory where נוצר מתוך = deleted template ID
   - Filter: future dates only, isSafeToDeactivate = true
   - Deactivate: set סטטוס = "blocked"
   - Log protected slots that couldn't be deactivated
```

**Webhook Configuration:**
- Table: weekly_slot
- Events: record created, updated, deleted
- Filter (optional): Only if specific fields change (e.g., start_time, end_time, teacher_id)

**Modules/Actions:**
- Airtable: Search Records (find affected inventory)
- Airtable: Update Records (batch update for efficiency)
- Airtable: Create Records (batch create)
- Make: Data Store (cache active template IDs for performance)
- Make: Webhook Response (acknowledge webhook)

### 3. Overlap Detection (Separate Scenario)

**Trigger:** After sync completes OR on-demand

**Make Scenario: "Slot Inventory - Overlap Detection"**

**Flow:**
```
1. Airtable: Search Records (slot_inventory)
   - Filter: תאריך שיעור >= today
   - Get: natural_key, מזהה מורה, תאריך שיעור, StartDT, EndDT

2. Make: Group by teacher + date
   - Group records by: מזהה מורה + תאריך שיעור

3. Make: Iterator (each group)
   - For each pair in group:
     - Check: StartDT1 < EndDT2 AND StartDT2 < EndDT1
     - IF overlap:
       - Log to overlap log table
       - Optionally: Set has_overlap flag on weekly_slot template

4. Make: Email/Notification
   - Send overlap report to Raz
```

### Implementation Priority

**Phase 1: Scheduled Sync (Critical)**
- Implement scenario 1
- Test with small date range
- Verify CREATE/UPDATE/DEACTIVATE logic

**Phase 2: On-Change Sync (Important)**
- Implement webhook scenario
- Test template edits
- Handle edge cases (time changes with lessons)

**Phase 3: Overlap Detection (Nice to Have)**
- Implement overlap detection
- Set up alerts

**Phase 4: Refactor Existing Scenarios**
- Deprecate old "weekly creation" scenarios
- Migrate to new sync engine
- Keep "recurring lessons" scenario separate (different purpose)

### Make-Specific Considerations

**Performance:**
- Use batch operations where possible (Make supports batch create/update)
- Limit date range for initial testing (e.g., 7 days instead of 14)
- Cache template data in Make Data Store to reduce API calls

**Error Handling:**
- Use Make error handling for each operation
- Log errors to Airtable error log table
- Set up Make error notifications

**Testing:**
- Create test teacher and templates
- Run sync on test data first
- Verify natural_key generation
- Verify protection logic (is_locked, lessons, is_block)

**Monitoring:**
- Add Make scenario execution logs
- Track: created/updated/deactivated counts
- Alert on high error rates

---

## Summary

This specification provides a complete blueprint for synchronizing weekly_slot templates to slot_inventory, with clear rules for protection, overlap detection, and conflict resolution. The Make implementation plan provides step-by-step flows for both scheduled and on-change sync scenarios.
