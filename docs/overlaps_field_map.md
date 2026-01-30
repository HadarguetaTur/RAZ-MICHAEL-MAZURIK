# מפת שדות - Overlaps Field Map

מסמך זה מתעד את השדות המדויקים עבור `lessons`, `weekly_slot`, ו-`slot_inventory` כפי שהם מופיעים ב-Airtable ובקוד.

## מקורות נתונים (Data Sources)

### Lessons
- **טבלת Airtable**: `tblz6twflNw2iB832` (display name: `lessons`)
- **מקום בקוד**: 
  - `services/nexusApi.ts` → `getLessons()` (שורות 663-852)
  - `data/resources/lessons.ts` → `getLessons()` (wrapper עם cache)
  - `data/hooks/useLessons.ts` → React hook

### Weekly Slot
- **טבלת Airtable**: `tbloC7G7ixYDMtdK6` (display name: `weekly_slot`)
- **מקום בקוד**:
  - `services/nexusApi.ts` → `getWeeklySlots()` (שורות 854-1083)
  - `services/slotManagementService.ts` → `getWeeklySlots()` (שורות 135-169)
  - `data/resources/weeklySlots.ts` → `getWeeklySlots()` (wrapper עם cache)
  - `data/hooks/useWeeklySlots.ts` → React hook

### Slot Inventory
- **טבלת Airtable**: `tblqMt721kMMtRIWm` (display name: `slot_inventory`)
- **מקום בקוד**:
  - `services/nexusApi.ts` → `getSlotInventory()` (שורות 1085-1203)
  - `services/slotManagementService.ts` → `getSlotInventory()` (שורות 174-195)
  - `data/resources/slotInventory.ts` → `getSlotInventory()` (wrapper עם cache)
  - `data/hooks/useSlotInventory.ts` → React hook

---

## מפת שדות (Field Map)

### Lessons Table (`tblz6twflNw2iB832`)

| Source Table | Field Name | Type | Example | Notes |
|-------------|------------|------|---------|-------|
| lessons | `lesson_id` | String | `"L-2024-001"` | Primary field - lesson identifier |
| lessons | `full_name` | Linked Record | `["recABC123"]` | Linked to Students table (may be multi-link) |
| lessons | `status` | String | `"מתוכנן"` | Lesson status: מתוכנן, אישר הגעה, בוצע, בוטל, ממתין, לא הופיע, ממתין לאישור ביטול |
| lessons | `lesson_date` | Date | `"2024-01-15"` | Date format (YYYY-MM-DD) |
| lessons | `start_datetime` | DateTime | `"2024-01-15T10:00:00.000Z"` | ISO datetime string - used for date/time extraction |
| lessons | `end_datetime` | DateTime | `"2024-01-15T11:00:00.000Z"` | ISO datetime string - used for duration calculation |
| lessons | `teacher_id` | Linked Record | `["recXYZ789"]` | Linked to Teachers table |
| lessons | `slot` | Linked Record | `["recSLOT456"]` | Linked to weekly_slot table (optional) |
| lessons | `duration` | Number | `60` | Duration in minutes |
| lessons | `lesson_type` | String | `"פרטי"` | Type: פרטי, זוגי, קבוצתי |
| lessons | `attendance_confirmed` | Boolean | `true` | Attendance confirmation flag |
| lessons | `reminder_sent` | Boolean | `false` | Reminder sent flag |
| lessons | `cancellation_reason` | String | `"ביטול על ידי תלמיד"` | Cancellation reason (read-only formula) |
| lessons | `price` | Number | `150` | Lesson price |
| lessons | `calender_event_id` | String | `"event_123"` | Calendar event ID |
| lessons | `source` | String | `"manual"` | Source of lesson creation |
| lessons | `פרטי_השיעור` | Formula | `"שיעור פרטי - מתמטיקה"` | **Read-only** - Formula field for lesson details |
| lessons | `count_this_week` | Formula | `3` | **Read-only** - Formula field |
| lessons | `billing_month` | Formula | `"2024-01"` | **Read-only** - Formula: YYYY-MM format |
| lessons | `is_billable` | Formula | `true` | **Read-only** - Formula field |
| lessons | `unit_price` | Formula | `150` | **Read-only** - Formula field |
| lessons | `line_amount` | Formula | `150` | **Read-only** - Formula field |
| lessons | `קיבולת` | Formula | `1` | **Read-only** - Formula field (capacity) |
| lessons | `is_in_current_business_week` | Formula | `true` | **Read-only** - Formula field |
| lessons | `is_in_next_business_week` | Formula | `false` | **Read-only** - Formula field |
| lessons | `business_week_start` | Formula | `"2024-01-14"` | **Read-only** - Formula field |
| lessons | `business_week_end` | Formula | `"2024-01-20"` | **Read-only** - Formula field |
| lessons | `StartDT` | Formula | `"2024-01-15T10:00:00.000Z"` | **Read-only** - Formula datetime field |
| lessons | `EndDT` | Formula | `"2024-01-15T11:00:00.000Z"` | **Read-only** - Formula datetime field |

**שדות נוספים שמופיעים בקוד אך לא מתועדים ב-fieldMap:**
- `Student` - Lookup field (used in `mapAirtableToLesson`)
- `Teacher` - Lookup field (used in `mapAirtableToLesson`)
- `Student_ID` - Used in `mapAirtableToLesson` (שורה 272)
- `Teacher_ID` - Used in `mapAirtableToLesson` (שורה 276)
- `Student_Name` - Used in `mapAirtableToLesson` (שורה 275)
- `Teacher_Name` - Used in `mapAirtableToLesson` (שורה 277)

---

### Weekly Slot Table (`tbloC7G7ixYDMtdK6`)

| Source Table | Field Name | Type | Example | Notes |
|-------------|------------|------|---------|-------|
| weekly_slot | `day_of_week` | Select/Number | `"0"` or `0` | Day of week: 0-6 (0 = Sunday, 6 = Saturday). Can be string or number |
| weekly_slot | `day_num` | Number | `1` | Normalized day number: 1-7 (1 = Sunday, 7 = Saturday). Preferred over `day_of_week` |
| weekly_slot | `start_time` | Time | `"10:00"` | Start time format (HH:mm) |
| weekly_slot | `end_time` | Time | `"11:00"` | End time format (HH:mm) |
| weekly_slot | `teacher_id` | Linked Record | `["recXYZ789"]` | Linked to Teachers table (required) |
| weekly_slot | `reserved_for` | Linked Record | `["recABC123"]` | Linked to Students table (optional) |
| weekly_slot | `is_reserved` | Boolean | `false` | Reserved flag (0/1 or boolean) |
| weekly_slot | `type` | String | `"פרטי"` | Type: פרטי, זוגי, קבוצתי |
| weekly_slot | `slot` | String | `"SLOT-001"` | Slot identifier (optional) |
| weekly_slot | `duration_min` | Number | `60` | Duration in minutes (optional - can be calculated from start_time/end_time) |
| weekly_slot | `קבוע` | Boolean | `true` | Fixed/recurring slot flag (0/1 or boolean) |
| weekly_slot | `has_overlap` | Boolean | `false` | Has overlap flag (0/1 or boolean) |
| weekly_slot | `overlap_with` | Linked Record | `["recSLOT456"]` | Linked to weekly_slot table (optional) |
| weekly_slot | `overlap_details` | String | `"Overlaps with slot..."` | Overlap details text |
| weekly_slot | `קיבולת` | Formula | `1` | **Read-only** - Formula field (capacity) |

**מיפוי שדות בקוד:**
- `teacherId` ← `teacher_id` (Linked Record - extract first ID from array)
- `dayOfWeek` ← `day_num` (preferred) or `day_of_week` (fallback, normalized to 0-6)
- `startTime` ← `start_time`
- `endTime` ← `end_time`
- `duration` ← `duration_min` or calculated from `start_time`/`end_time`
- `isFixed` ← `קבוע` (boolean check)
- `isReserved` ← `is_reserved` (boolean check)
- `reservedFor` ← `reserved_for` (Linked Record - extract first ID from array)
- `type` ← `type`
- `status` ← Defaults to `'active'` (no status field exists)

---

### Slot Inventory Table (`tblqMt721kMMtRIWm`)

| Source Table | Field Name | Type | Example | Notes |
|-------------|------------|------|---------|-------|
| slot_inventory | `natural_key` | String | `"recXYZ789\|2024-01-15\|10:00"` | Primary field - Format: `teacherId\|YYYY-MM-DD\|HH:mm` |
| slot_inventory | `מורה` | Linked Record | `["recXYZ789"]` | **Preferred** - Linked to Teachers table. Use this instead of `מזהה_מורה` |
| slot_inventory | `מזהה_מורה` | Text | `"1"` | **Deprecated** - Text field containing invalid values. Do not use. |
| slot_inventory | `תאריך_שיעור` | Date | `"2024-01-15"` | Lesson date (YYYY-MM-DD format) |
| slot_inventory | `שעת_התחלה` | Time | `"10:00"` | Start time format (HH:mm) |
| slot_inventory | `שעת_סיום` | Time | `"11:00"` | End time format (HH:mm) |
| slot_inventory | `סוג_שיעור` | String | `"פרטי"` | Lesson type: פרטי, זוגי, קבוצתי |
| slot_inventory | `חדר` | String | `"חדר 1"` | Room assignment (optional) |
| slot_inventory | `קיבולת_כוללת` | Number | `1` | Total capacity (optional) |
| slot_inventory | `תפוסה_נוכחית` | Rollup | `1` | **Read-only** - Rollup from lessons table |
| slot_inventory | `סטטוס` | String | `"open"` | Status: `open`, `booked`, `blocked`, `סגור` (Hebrew "closed" mapped to "booked") |
| slot_inventory | `נוצר_מתוך` | Linked Record | `["recSLOT456"]` | **Important** - Linked to weekly_slot table. Indicates source template |
| slot_inventory | `הוחלו_חריגות` | Boolean | `false` | Exceptions applied flag (0/1 or boolean) |
| slot_inventory | `הערות` | String | `"הערה כלשהי"` | Notes field (optional) |
| slot_inventory | `day_of_week` | Number | `1` | Day of week (1-7, where 1=Sunday) - for reference |
| slot_inventory | `is_locked` | Boolean | `false` | Protection flag - prevents automatic updates (0/1 or boolean) |
| slot_inventory | `lessons` | Linked Record | `["recLESSON123"]` | Linked to lessons table (optional) |
| slot_inventory | `תלמידים` | Linked Record | `["recABC123"]` | Alternative field name for students (optional) |
| slot_inventory | `is_full` | Formula | `true` | **Read-only** - Formula field |
| slot_inventory | `is_block` | Formula | `false` | **Read-only** - Formula field |
| slot_inventory | `StartDT` | Formula | `"2024-01-15T10:00:00.000Z"` | **Read-only** - Formula datetime field (used for overlap detection) |
| slot_inventory | `EndDT` | Formula | `"2024-01-15T11:00:00.000Z"` | **Read-only** - Formula datetime field (used for overlap detection) |

**מיפוי שדות בקוד:**
- `teacherId` ← `מורה` (Linked Record - extract first ID from array) - **NOT** `מזהה_מורה`
- `date` ← `תאריך_שיעור`
- `startTime` ← `שעת_התחלה`
- `endTime` ← `שעת_סיום`
- `status` ← `סטטוס` (normalized: `סגור` → `booked`)
- `createdFrom` ← `נוצר_מתוך` (Linked Record - extract first ID from array)
- `isLocked` ← `is_locked` (boolean check)
- `hasLessons` ← `lessons` or `תלמידים` (check if array is not empty)
- `isBlock` ← `is_block` (formula field)

---

## לוגיקת "פתיחת שבוע" / שכפול weekly_slot ל-slot_inventory

### מיקום בקוד

#### 1. Weekly Rollover Service
**מיקום**: `services/weeklyRolloverService.ts`

**פונקציות עיקריות**:
- `performWeeklyRollover()` (שורות 51-86) - פונקציה ראשית לביצוע rollover שבועי
- `openNewWeek()` (שורות 23-39) - פותח שבוע חדש
- `createSlotInventoryForWeek()` - קורא ל-`slotManagementService.createSlotInventoryForWeek()`

**תהליך**:
1. מחשב שבועות פתוחים נוכחיים (`calculateOpenWeeks()`)
2. קובע שבוע חדש לפתיחה
3. סוגר שבוע עבר (לוגי בלבד - אין מחיקה)
4. פותח שבוע חדש (יוצר slot_inventory ו-lessons קבועים)

#### 2. Slot Management Service
**מיקום**: `services/slotManagementService.ts`

**פונקציות עיקריות**:
- `createSlotInventoryForWeek()` (שורות 274-317) - יוצר slot_inventory עבור שבוע ספציפי
- `createSlotInventory()` (שורות 223-268) - יוצר רשומת slot_inventory בודדת

**תהליך**:
1. שולף את כל ה-weekly_slot הרלוונטיים
2. מסנן רק slots לא-קבועים (`!slot.isFixed`) ופעילים (`status === 'active'`)
3. עבור כל slot:
   - מחשב תאריך לפי `dayOfWeek` ו-`weekStart`
   - יוצר `natural_key` בפורמט: `teacherId|date|startTime`
   - בודק אם כבר קיים (idempotency)
   - יוצר רשומת slot_inventory עם:
     - `natural_key`
     - `מורה` ← `teacherId`
     - `תאריך_שיעור` ← תאריך מחושב
     - `שעת_התחלה` ← `startTime`
     - `שעת_סיום` ← `endTime`
     - `נוצר_מתוך` ← `slot.id` (קישור ל-weekly_slot)
     - `סוג_שיעור` ← `type` (אם קיים)
     - `סטטוס` ← `"open"`

#### 3. Slot Sync Service
**מיקום**: `services/slotSync.ts`

**פונקציות עיקריות**:
- `syncSlots()` (שורות 353-596) - סנכרון מלא של weekly_slot → slot_inventory
- `generateInventoryFromTemplates()` (שורות 118-168) - יוצר slots מ-templates
- `diffInventory()` (שורות 271-330) - מחשב הבדלים בין קיים ל-נוצר

**תהליך**:
1. טוען weekly_slot templates
2. יוצר slots עבור טווח תאריכים (default: 14 ימים קדימה)
3. טוען slot_inventory קיים בטווח התאריכים
4. מזהה overlaps
5. מחשב diff: מה ליצור, לעדכן, או לבטל
6. מבצע פעולות:
   - **CREATE**: יוצר slots חסרים
   - **UPDATE**: מעדכן slots בטוחים (לא locked, אין lessons, לא blocked)
   - **DEACTIVATE**: מבטל slots מ-templates לא פעילים

**שדות שמועתקים מ-weekly_slot ל-slot_inventory**:
- `מורה` ← `teacher_id`
- `שעת_התחלה` ← `start_time`
- `שעת_סיום` ← `end_time`
- `סוג_שיעור` ← `type`
- `נוצר_מתוך` ← weekly_slot record ID (link)
- `קיבולת_כוללת` ← `קיבולת` (אם קיים ב-template)

**שדות שלא מועתקים** (נשלטים על ידי slot_inventory):
- `natural_key` - נוצר מ-`teacherId|date|startTime`
- `תאריך_שיעור` - נקבע לפי תאריך sync
- `סטטוס` - נשלט ידנית (default: `"open"`)
- `תפוסה_נוכחית` - Rollup (read-only)
- `lessons` / `תלמידים` - נשלט על ידי יצירת lessons
- `הערות` - הערות ספציפיות לתאריך
- `הוחלו_חריגות` - flag לחריגות
- `חדר` - הקצאת חדר ספציפית לתאריך
- `is_locked` - flag הגנה (ידני בלבד)

#### 4. Scripts
**מיקום**: `scripts/weeklyRollover.ts`

**שימוש**:
```bash
npm run rollover              # Run rollover for current date
npm run rollover -- --date YYYY-MM-DD  # Run for specific date
npm run rollover -- --dry-run  # Dry run (no changes)
```

**תהליך**:
- קורא ל-`performWeeklyRollover()` מ-`weeklyRolloverService`
- מציג לוגים ותוצאות

### תיעוד נוסף

#### מסמכי תיעוד:
1. **`SLOT_SYNC_SPEC.md`** - מפרט מלא של תהליך הסנכרון
   - כללי הגנה (protection rules)
   - זיהוי overlaps
   - טיפול בשינויים ב-weekly_slot
   - תרחישי Make

2. **`EXECUTION_PLAN_SLOT_INVENTORY.md`** - תוכנית ביצוע למימוש

3. **`SLOT_INVENTORY_FIELD_MAPPINGS.md`** - מיפוי שדות ספציפי ל-slot_inventory

4. **`GET_OPEN_SLOTS_FIELD_MAPPING.md`** - מיפוי שדות ל-getOpenSlots

### הערות חשובות

1. **שדה מורה**: תמיד להשתמש ב-`מורה` (Linked Record) ולא ב-`מזהה_מורה` (Text field עם ערכים לא תקינים)

2. **נוצר מתוך**: השדה `נוצר_מתוך` הוא קישור ל-weekly_slot ומציין מאיזה template נוצר ה-slot. זה קריטי לסנכרון.

3. **הגנה על slots**: Slot מוגן אם:
   - `is_locked = true`
   - `lessons` לא ריק
   - `is_block = true`
   
   Slots מוגנים לא יעודכנו אוטומטית.

4. **Overlap Detection**: משתמש ב-`StartDT` ו-`EndDT` (formula fields) לזיהוי מדויק של overlaps.

5. **Natural Key**: הפורמט הוא `teacherId|YYYY-MM-DD|HH:mm` ומשמש כמפתח ייחודי.

6. **Status Values**: 
   - `open` - פתוח להזמנה
   - `booked` - תפוס (או `סגור` בעברית)
   - `blocked` - חסום

---

## סיכום

### Lessons
- **מקור**: Airtable table `tblz6twflNw2iB832`
- **שדות זמן**: `start_datetime`, `end_datetime` (ISO datetime)
- **שדה תאריך**: `lesson_date` (Date)
- **מורה**: `teacher_id` (Linked Record)
- **סטטוס**: `status` (String)

### Weekly Slot
- **מקור**: Airtable table `tbloC7G7ixYDMtdK6`
- **יום בשבוע**: `day_num` (preferred) או `day_of_week` (fallback)
- **זמנים**: `start_time`, `end_time` (Time format HH:mm)
- **מורה**: `teacher_id` (Linked Record)
- **קבוע**: `קבוע` (Boolean)

### Slot Inventory
- **מקור**: Airtable table `tblqMt721kMMtRIWm`
- **תאריך**: `תאריך_שיעור` (Date)
- **זמנים**: `שעת_התחלה`, `שעת_סיום` (Time format HH:mm)
- **מורה**: `מורה` (Linked Record) - **NOT** `מזהה_מורה`
- **סטטוס**: `סטטוס` (String: open/booked/blocked)
- **מקור**: `נוצר_מתוך` (Linked Record ל-weekly_slot)

### לוגיקת פתיחת שבוע
- **מיקום עיקרי**: `services/weeklyRolloverService.ts`, `services/slotManagementService.ts`, `services/slotSync.ts`
- **תהליך**: weekly_slot templates → slot_inventory dated slots
- **תיעוד**: `SLOT_SYNC_SPEC.md`, `EXECUTION_PLAN_SLOT_INVENTORY.md`
