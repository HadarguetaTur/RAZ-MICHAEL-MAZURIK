# מיפוי קביעת שיעור (Lesson scheduling flow)

## נקודות כניסה ליצירת שיעור

| כניסה | קומפוננטה/שירות | קריאה ל-API | הערות |
|--------|------------------|-------------|--------|
| **לוח שיעורים – שיעור חדש** | [Calendar.tsx](components/Calendar.tsx) | `nexusApi.createLesson(...)` ישירות (שורה ~691) | כפתור "שיעור חדש" → מודל "קביעת שיעור חדש" → שמירה ב-`performSave` (create path). **לא** עובר דרך `data/mutations.createLesson`. |
| **הזמנת חלון (slot_inventory)** | [SlotInventoryModal](components/SlotInventoryModal.tsx) → [slotBookingService](services/slotBookingService.ts) | `nexusApi.createLesson(...)` מתוך `reserveSlotAndCreateLessons` (שורה ~213) | משתמש בוחר תלמידים על חלון פתוח → סגירת חלון + יצירת שיעור(ים). מקור: `source: 'slot_inventory'`. |
| **פתיחת שבוע – שיעורים קבועים** | [weeklyRolloverService](services/weeklyRolloverService.ts) → [slotManagementService.createFixedLessonsForWeek](services/slotManagementService.ts) | `nexusApi.createLesson(...)` בלולאה (שורות ~508, 537, 564) | לכל weekly_slot עם קבוע=true ו-reserved_for: יוצר שיעור(ים) לפי סוג (פרטי/זוגי/קבוצתי). |

## זרימה מרגע לחיצה על שמירה (לוח שיעורים)

```
Calendar.tsx
  → performSave() [create path: !selectedLesson]
  → nexusApi.createLesson({ studentId, date, startTime, duration, teacherId, lessonType, status: SCHEDULED, ... })
  → [nexusApi] createLesson:
       1. אימות studentId (מזהה Airtable)
       2. חישוב start_datetime / end_datetime (UTC)
       3. בדיקת התנגשויות שיעורים (getLessons + filter)
       4. אופציונלי: בדיקת חלונות פתוחים חופפים (validateConflicts) + חסימת יצירה או סגירה אוטומטית
       5. בניית payload: fields לפי fieldMap (status, lesson_date, full_name, teacher_id, lesson_type, ...)
       6. POST ל-Airtable (טבלת lessons)
       7. אופציונלי: טריגר Make.com לסנכרון לוח
  → refreshData(true)
```

## שדות קריטיים ב-createLesson (Airtable Single Select)

- **status** – ערך נשלח כרגע: `validStatusValue` (מדגימת שיעור קיים) או `"מתוכנן "` (עם רווח בסוף). חייב להתאים בדיוק לאופציה בטבלה.
- **lesson_type (סוג שיעור)** – מיפוי: `private`→`"פרטי "`, `pair`→`"זוגי "`, `group`→`"קבוצתי "` (עם רווח בסוף).

## עדכון שיעור (לא יצירה)

- Calendar משתמש ב-**`updateLesson`** מ-[data/mutations.ts](data/mutations.ts) (שורה 681 לעדכון, 924/965 לביטול).
- `mutations.updateLesson` קורא ל-`nexusApi.updateLesson`.

## קאש וביטול אחרי יצירה

- יצירה ישירה מ-Calendar **לא** קוראת ל-`invalidateLessons`/`invalidateSlotInventory` לפני ה-create; Calendar קורא ל-`refreshData(true)` אחרי create.
- `data/mutations.createLesson` **כן** מבטל קאש; כרגע לא בשימוש בנתיב "שיעור חדש" בלוח (נקרא רק nexusApi).

---

## שיעורים מחזוריים (Recurring lessons)

### זרימה

קביעה של שיעור מחזורי: (1) רישום ב-**weekly_slot** (תבנית שבועית עם `קבוע=true`, `is_reserved`), (2) רישום ב-**lessons** בתאריך הספציפי (למשל השבוע הנוכחי), (3) קישור שיעור ↔ תבנית דרך שדה `slot` (קישור ל-weekly_slot).

- **פתיחת שבוע:** [createFixedLessonsForWeek](services/slotManagementService.ts) יוצר שיעורים מכל weekly_slot עם `קבוע=true` ו-`reserved_for`, וממלא ב-lessons את השדה `slot` = id של ה-weekly_slot.
- **שריון מחזורי (פעולה אחת):** [reserveRecurringLesson](services/slotManagementService.ts) – יוצר או מעדכן weekly_slot, ויוצר שיעור(ים) לתאריך נתון עם קישור `slot`.

### API: reserveRecurringLesson

**שירות:** `slotManagementService.reserveRecurringLesson`  
**חשיפה:** `nexusApi.reserveRecurringLesson`

| פרמטר | סוג | חובה | תיאור |
|--------|-----|------|--------|
| teacherId | string | כן | Record ID מורה |
| dayOfWeek | number | כן | 0=ראשון … 6=שבת |
| startTime | string | כן | HH:mm |
| endTime | string | כן | HH:mm |
| type | 'private' \| 'group' \| 'pair' | כן | סוג שיעור |
| reservedForIds | string[] | כן | מערך Record IDs תלמידים |
| durationMin | number | לא | ברירת מחדל: חישוב מ-start/end או 60 |
| targetDate | Date | לא | שבוע שממנו מחשבים תאריך השיעור; ברירת מחדל: השבוע הנוכחי |
| weeklySlotId | string | לא | אם נתון – מעדכן את ה-slot הקיים במקום ליצור חדש |

**החזרה:** `{ weeklySlot: WeeklySlot; lessonIds: string[] }`

### שדות נדרשים ב-weekly_slot לשריון מחזורי

גוף הבקשה ל-Airtable תואם למפרט: שדות קישור (reserved_for, teacher_id) כמערך Record IDs; day_of_week כטקסט יום בשבוע בעברית ("ראשון" … "שבת"); is_reserved, קבוע, type, זמנים ו-duration_min כמתואר.

| שדה | סוג | תיאור |
|-----|-----|--------|
| reserved_for | LinkedRecord | מערך Record IDs תלמידים |
| is_reserved | Single Select / Checkbox | "לא פנוי" (או true) כשמשוריין |
| קבוע | Checkbox | true = שיעור מחזורי |
| type | Single Select | "פרטי", "זוגי", "קבוצתי" |
| teacher_id | LinkedRecord | מערך Record ID מורה |
| day_of_week | טקסט | יום בשבוע בעברית: "ראשון","שני",...,"שבת" |
| start_time, end_time | Single Select / string | "12:20", "13:20" |
| duration_min | number | אופציונלי – מחושב אוטומטית |

### קישור שיעור ↔ תבנית (weekly_slot)

- ב-**createLesson** ניתן להעביר `weeklySlotId`; השדה `slot` בטבלת lessons ייכתב כ-`[weeklySlotId]`.
- **createFixedLessonsForWeek** מעביר `weeklySlotId: slot.id` בכל קריאה ל-createLesson.
