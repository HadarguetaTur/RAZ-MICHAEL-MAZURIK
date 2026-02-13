# מיפוי שדות Airtable ולוגיקת חיובים – מקור הכפילויות

## 1. טבלת תלמידים (students) – רק קריאה

| שדה | שימוש | קובץ |
|-----|------|------|
| `id` (record) | מזהה תלמיד | billingEngine – לולאת עיבוד |
| `full_name` | שם לתצוגה | students – לא בשימוש בחישוב |
| `is_active` | פילטר: רק 1 | billingEngine שורה 407 – `{is_active} = 1` |

---

## 2. טבלת שיעורים (lessons) – קריאה בלבד

| שדה | שימוש | חישוב |
|-----|------|-------|
| `full_name` | קישור לתלמיד (recXXX) | קיבוץ לפי תלמיד, בדיקה שהשיעור שייך לתלמיד |
| `billing_month` | פילטר + שיוך לחודש | פילטר Airtable: `{billing_month} = "YYYY-MM"` או `FIND("YYYY-MM", {billing_month})=1` |
| `start_datetime` | fallback ל-billing_month | אם `billing_month` ריק – בודק אם התאריך בטווח החודש |
| `lesson_date` | לא בשימוש | - |
| `lesson_type` | קביעת מחיר | פרטי→175, זוגי→112.5/0, קבוצתי→120/0 |
| `status` | האם לחייב | רק: הסתיים, מתוכנן, בוצע, אישר הגעה, attended, scheduled |
| `line_amount` | סכום לשיעור | אם קיים – משתמש. אחרת לפי סוג שיעור |
| `price` | זוגי | אם line_amount ריק – `price/2` |
| `unit_price` | לא משמש בחישוב | - |

### פילטר Airtable לשיעורים:
```
OR(
  {billing_month} = "YYYY-MM",
  AND(
    IS_AFTER({start_datetime}, "YYYY-MM-01"),
    IS_BEFORE({start_datetime}, "YYYY-MM-lastDay")
  )
)
```

---

## 3. טבלת ביטולים (cancellations) – קריאה בלבד

| שדה | שימוש | חישוב |
|-----|------|-------|
| `student` | קישור לתלמיד | קיבוץ לפי תלמיד |
| `billing_month` | פילטר + שיוך לחודש | התאמה מדויקת: `=== billingMonth` |
| `is_lt_24h` | האם לחייב | רק `=== 1` |
| `is_charged` | סטטוס | `false` → ממתין, לא נספר בסכום |
| `charge` | סכום | אם קיים – משתמש, אחרת מחשב לפי שיעור מקושר |
| `lesson` | קישור לשיעור | לקביעת מחיר לפי lesson_type |

### פילטר Airtable:
```
{billing_month} = "YYYY-MM"
```

---

## 4. טבלת מנויים (subscriptions) – קריאה בלבד

| שדה | שימוש | חישוב |
|-----|------|-------|
| `student_id` | קישור לתלמיד | קיבוץ לפי תלמיד |
| `subscription_start_date` | תחילת מנוי | חייב להיות ≤ סוף חודש |
| `subscription_end_date` | סוף מנוי | ריק או ≥ תחילת חודש |
| `pause_subscription` | השעיה | true → לא נספר |
| `monthly_amount` | סכום | `parseMonthlyAmount` – מסנן ₪, רווחים, פסיקים |

### חישוב:
- `subscriptionsTotal` = סכום כל המנויים הפעילים בחודש
- מנוי פעיל = לא מושהה, התחיל לפני סוף החודש, הסתיים אחרי תחילת החודש (או ללא סוף)

---

## 5. טבלת חיובים (חיובים / monthlyBills) – קריאה וכתיבה

### 5.1 קריאה – בדיקת חיוב קיים

| שדה | שימוש | בעיה אפשרית |
|-----|------|-------------|
| **`full_name`** | קישור לתלמיד + בניית `billsByStudent` | אם בטבלה השדה נקרא **`תלמיד`** – `bill.fields.full_name` יהיה undefined |
| `חודש חיוב` | פילטר לפי חודש | Date או Text – הפילטר תומך בשניהם |

### בניית billsByStudent:
```javascript
for (const bill of allExistingBills) {
  if (!bill.fields.full_name) continue;  // אם תלמיד – דילוג, הביל לא נכנס למפה
  const sId = extractStudentId(bill.fields.full_name);
  billsByStudent.set(sId, bill);
}
```

### שאילתת חיוב קיים (buildStudentMonth):
```javascript
AND(
  {full_name} = "recStudentId",
  OR(YEAR({חודש חיוב})=Y, MONTH({חודש חיוב})=M, {חודש חיוב}="YYYY-MM")
)
```

**כשל אפשרי:** אם שדה התלמיד ב-Airtable הוא `תלמיד` ולא `full_name`, השאילתה לא תמצא רשומות קיימות.

### 5.2 כתיבה – יצירה/עדכון רשומת חיוב

| שדה | ערך | מקור |
|-----|-----|------|
| `חודש חיוב` | YYYY-MM-01 (Date) | `billingMonth` |
| `שולם` | true/false | מהרשומה הקיימת (אם יש) |
| `מאושר לחיוב` | boolean | לפי pendingCancellations, isPaid |
| **`full_name`** | [studentRecordId] | תמיד `full_name` |
| `lessons_amount` | number | `calculateLessonsContribution` |
| `subscriptions_amount` | number | `calculateSubscriptionsContribution` |
| `cancellations_amount` | number | `calculateCancellationsContribution` |
| `total_amount` | number | `lessons + subscriptions + cancellations` |
| `lessons_count` | number | `lessonsContribution.lessonsCount` |
| `manual_adjustment_*` | אם קיים | העתקה מהרשומה הקיימת |

---

## 6. סיכום חישובים (לא שדות Airtable)

| חישוב | נוסחה | קובץ |
|-------|-------|------|
| lessonsTotal | סכום לפי `calculateLessonAmount` לכל שיעור | billingRules |
| lessonsCount | מספר שיעורים שחויבו | billingRules |
| cancellationsTotal | סכום ביטולים (charge או לפי lesson_type) | billingRules |
| subscriptionsTotal | סכום מנויים פעילים | billingRules |
| total | lessonsTotal + cancellationsTotal + subscriptionsTotal | billingRules – `calculateTotal` |

---

## 7. סיבה אפשרית לכפילות חיובים

**אם שדה התלמיד בטבלת "חיובים" ב-Airtable הוא `תלמיד` ולא `full_name`:**

1. `billsByStudent` – קורא `bill.fields.full_name` → undefined → דילוג על כל הבילים → המפה ריקה.
2. `existingBill` – תמיד undefined → אין prefetch ל־buildStudentMonth.
3. ב־buildStudentMonth נשלחת שאילתה עם `{full_name} = "recXXX"` – אין התאמה לרשומות עם `תלמיד`.
4. `matchingBills.length === 0` → יוצרים רשומת חיוב חדשה.
5. רשומה קיימת (עם `תלמיד`) נשארת → נוצרת כפילות: אותה תלמיד + אותו חודש.

---

## 8. תרשים זרימת נתונים

```
[1] allExistingBills
    פילטר: חודש חיוב = billingMonth
    ↓
[2] billsByStudent = Map
    לכל bill: sId = extractStudentId(bill.fields.full_name)  ← אם full_name ריק – דילוג
    billsByStudent.set(sId, bill)
    ↓
[3] buildStudentMonth(sId)
    existingBill = billsByStudent.get(sId)  ← undefined אם full_name שגוי
    ↓
[4] אם existingBill ריק:
    matchingBills = query AND({full_name}=sId, חודש חיוב)  ← אם תלמיד – 0 תוצאות
    ↓
[5] matchingBills.length === 0
    → createRecord()  ← יוצר כפילות
```

---

## 9. המלצה לתיקון הכפילויות

1. לבדוק ב-Airtable מה שם שדה הקישור לתלמיד בטבלת "חיובים" – `full_name` או `תלמיד`.
2. אם השדה הוא `תלמיד`, לעדכן את billingEngine:
   - לבנות את `billsByStudent` לפי `bill.fields.full_name || bill.fields['תלמיד']`
   - להשתמש ב־discoverChargeTableSchema.studentField בשאילתה ובהוספת רשומה חדשה.
