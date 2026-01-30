# מימוש: בדיקת חפיפה ל-slot_inventory מול lessons

## סיכום

הוספת מנגנון מינימלי ובטוח לבדיקת חפיפה לפני שמירת `slot_inventory` פתוח. אם הסלוט חופף לשיעור קיים, השמירה נחסמת ומציגה הודעת שגיאה ברורה מעל כפתור "שמור".

---

## רשימת קבצים ששונו

### 1. `components/Availability.tsx`
**שינויים:**
- הוספת state: `slotInventoryValidationError` (שורה 116)
- שינוי `handleSave()`: הוספת בדיקת חפיפות לפני Save (שורות 606-663)
- הוספת UI: Alert מעל כפתור "שמור" (שורות 1133-1150)
- שינוי כפתור "שמור": disabled כשיש שגיאת validation (שורה 1147)
- שיפור Error Handling ב-`performSave()`: טיפול ב-CONFLICT_ERROR (409) (שורות 545-560)

### 2. `services/slotManagementService.ts`
**שינויים:**
- שינוי `createSlotInventory()`: זורק שגיאה 409 במקום לשנות סטטוס ל-'closed' (שורות 295-306)

---

## איפה בדיוק בוצעה החסימה

### Client-Side (UI)

**מיקום:** `components/Availability.tsx:handleSave()` (שורה 548)

**תהליך:**
1. משתמש לוחץ "שמור" על slot_inventory
2. `handleSave()` מזהה שזה slot_inventory (לא weekly_slot) (שורה 607)
3. בודק שדות חובה: תאריך, שעת התחלה, שעת סיום (שורות 613-616)
4. קורא ל-`checkConflictsViaAPI()` דרך `/api/conflicts/check` (שורות 622-628)
5. אם נמצאו חפיפות עם שיעורים (`source === 'lessons'`):
   - מגדיר `slotInventoryValidationError` עם הודעת שגיאה (שורות 642-645)
   - מחזיר `return` - **חסימה מוחלטת, לא ממשיך ל-`performSave()`** (שורה 647)
6. אם אין חפיפות:
   - מנקה שגיאות קודמות (שורה 652)
   - ממשיך ל-`performSave()` (שורה 666)

**UI:**
- Alert מוצג מעל כפתור "שמור" (שורות 1133-1150)
- כפתור "שמור" disabled כשיש `slotInventoryValidationError` (שורה 1147)
- ההודעה מציגה:
  - כותרת: "לא ניתן לשמור – יש X שיעורים קיימים בזמן הזה"
  - פירוט: תאריך + שעה + שם תלמיד/מזהה שיעור לכל חפיפה

### Server-Side (API)

**מיקום:** `services/slotManagementService.ts:createSlotInventory()` (שורה 268)

**תהליך:**
1. לפני יצירת slot_inventory עם `status='open'`
2. קורא ל-`preventSlotOpeningIfLessonsOverlap()` (שורות 288-293)
3. אם יש חפיפות (`!canOpen`):
   - זורק שגיאה `CONFLICT_ERROR` עם status 409 (שורות 295-306)
   - **חסימה מוחלטת** - לא יוצר את הסלוט
4. אם אין חפיפות:
   - ממשיך ליצירת הסלוט

**הערה:** `updateSlotInventory()` כבר בודק חפיפות (שורה 1674 ב-nexusApi.ts) ✅

---

## מקור נתונים - Lessons

**מיקום:** `components/Availability.tsx:checkConflictsViaAPI()` (שורה 417)

**מקור:**
- קריאה ל-`POST /api/conflicts/check` (שורה 429)
- השרת בודק lessons ליום הספציפי (`date`) + `teacherId` (אם קיים)
- אם אין `teacherId`, בודק לפי כל הארגון

**API Endpoint:** `server/apiServer.ts:182`
- תומך ב-`entity: 'slot_inventory'`
- מחזיר רק שיעורים חופפים (`source: 'lessons'`)

---

## בדיקות ידניות

### 1. צור סלוט בזמן שיש שיעור → נחסם עם הודעה

**תרחיש:**
1. פתח מסך "חריגים וחד פעמי"
2. לחץ על יצירת slot_inventory חדש
3. בחר מורה, תאריך, ושעות שחופפות לשיעור קיים
4. לחץ "שמור"

**תוצאה צפויה:**
- ✅ כפתור "שמור" מציג "בודק חפיפות..."
- ✅ Alert מוצג מעל הכפתורים:
  ```
  ⚠️ לא ניתן לשמור – יש 1 שיעור קיים בזמן הזה
  • 2025-01-29 10:00 - יוסי כהן (recABC123...)
  ```
- ✅ כפתור "שמור" disabled (אפור)
- ✅ הסלוט לא נוצר

---

### 2. צור סלוט בזמן פנוי → נשמר

**תרחיש:**
1. פתח מסך "חריגים וחד פעמי"
2. לחץ על יצירת slot_inventory חדש
3. בחר מורה, תאריך, ושעות שאין בהן שיעורים
4. לחץ "שמור"

**תוצאה צפויה:**
- ✅ כפתור "שמור" מציג "בודק חפיפות..."
- ✅ אין Alert (אין שגיאות)
- ✅ כפתור "שמור" פעיל (כחול)
- ✅ הסלוט נוצר בהצלחה
- ✅ המודל נסגר

---

### 3. ערוך סלוט קיים לשעה שמתנגשת → נחסם

**תרחיש:**
1. פתח מסך "חריגים וחד פעמי"
2. לחץ על עריכת slot_inventory קיים
3. שנה את השעות לשעות שחופפות לשיעור קיים
4. לחץ "שמור"

**תוצאה צפויה:**
- ✅ כפתור "שמור" מציג "בודק חפיפות..."
- ✅ Alert מוצג מעל הכפתורים עם פרטי החפיפה
- ✅ כפתור "שמור" disabled
- ✅ הסלוט לא מתעדכן
- ✅ המודל נשאר פתוח (ניתן לשנות את השעות)

---

## נקודות חשובות

1. **מינימלי ובטוח:**
   - רק בדיקה לפני Save
   - Alert מעל הכפתורים (לא מודל מורכב)
   - חסימה מוחלטת - לא ניתן לעקוף

2. **Reuse של לוגיקה קיימת:**
   - `checkConflictsViaAPI()` - כבר קיים
   - `/api/conflicts/check` - כבר תומך ב-`slot_inventory`
   - `preventSlotOpeningIfLessonsOverlap()` - כבר קיים

3. **Client + Server:**
   - Client: בדיקה לפני Save + Alert
   - Server: בדיקה ב-`createSlotInventory()` + `updateSlotInventory()` (כבר קיים)

4. **CREATE + UPDATE:**
   - הבדיקה עובדת בשני המקרים
   - ב-CREATE: `slotInventory?.id` הוא `undefined`
   - ב-UPDATE: `slotInventory?.id` הוא ה-ID של הסלוט

5. **Fail-Safe:**
   - אם הבדיקה נכשלת (API error), ממשיכים לשמירה (לא חוסמים)
   - אם הבדיקה בשרת נכשלת, זורק שגיאה 409

---

## שינויים שלא בוצעו

- **לא שונה:** מנגנון "קביעת שיעור" ביומן (Calendar.tsx) - נשאר ללא שינוי
- **לא הוסר:** מודל `LessonOverlapWarningModal` - נשאר בקוד (לא בשימוש כרגע)
- **לא הוסר:** `handleOverlapContinue()` - נשאר בקוד (לא בשימוש כרגע)

---

## סיכום טכני

**קבצים ששונו:** 2
- `components/Availability.tsx` - הוספת validation ב-UI
- `services/slotManagementService.ts` - שינוי validation בשרת

**קבצים ללא שינוי (reuse):**
- `services/conflictValidationService.ts` ✅
- `services/overlapDetection.ts` ✅
- `services/conflictsCheckService.ts` ✅
- `server/apiServer.ts` ✅

**לוגיקת חפיפה:** `hasOverlap()` - `aS < bE && aE > bS` (touching לא נחשב חפיפה)

**API:** `POST /api/conflicts/check` עם `entity: 'slot_inventory'`
