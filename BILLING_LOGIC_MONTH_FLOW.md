# לוגיקת חיובים - מעקב החודש הנבחר

## עקרון: חודש אחד = חיוב אחד לתלמיד

**כל רשומת חיוב** בטבלת "חיובים" אמורה לייצג **חודש בודד** עבור תלמיד בודד.

---

## 1. תצוגת חיובים (לפי חודש)

```
משתמש בוחר חודש (input type="month") → selectedMonth
    ↓
getMonthlyBills(selectedMonth)
    ↓
getChargesReport(airtableClient, { billingMonth: month })
    ↓
פילטר: OR(YEAR(חודש חיוב)=year, MONTH(חודש חיוב)=month)
        OR {חודש חיוב} = "YYYY-MM"
```

**מקור:** [services/billingService.ts](services/billingService.ts) - `buildFilterFormula` שורות 1482-1495

**תוצאה:** רק רשומות חיוב עם `חודש חיוב` תואם לחודש הנבחר.

---

## 2. יצירת חיובים (לפי חודש)

```
משתמש לוחץ "צור חיובים חודשיים"
    ↓
targetMonth = (selectedMonth === חודש נוכחי) ? חודש שעבר : selectedMonth
    ↓
createMonthlyCharges(targetMonth)
    ↓
buildMonthForAllActiveStudents(client, billingMonth)
```

**מקור:** [components/Billing.tsx](components/Billing.tsx) שורות 389-404

**חשוב:** נוצרת **רק** רשומת חיוב אחת לכל תלמיד, עבור `targetMonth` בלבד.

---

## 3. נתוני החיוב (שיעורים, ביטולים, מנויים)

### 3.1 שיעורים

**מנוע החיובים** ([billing/billingEngine.ts](billing/billingEngine.ts) שורות 534-544):

```
פילטר Airtable:
OR(
  {billing_month} = "YYYY-MM",
  AND(
    IS_AFTER({start_datetime}, "YYYY-MM-01"),
    IS_BEFORE({start_datetime}, "YYYY-MM-lastDay")
  )
)
```

**חישוב** ([billing/billingRules.ts](billing/billingRules.ts) - `calculateLessonsContribution`):
- שיעור נכלל **רק אם** `belongsToMonth`:
  - `billing_month === billingMonth` או
  - `billing_month` מתחיל ב-YYYY-MM או
  - `start_datetime` בטווח החודש (כש-`billing_month` ריק)

### 3.2 ביטולים

**מנוע:** `{billing_month} = "YYYY-MM"` – רק ביטולים עם `billing_month` תואם.

**חישוב:** `calculateCancellationsContribution` – ממשיך רק אם `cancellation.billing_month === billingMonth`.

### 3.3 מנויים

**ללא פילטר חודש** – נטענים כל המנויים.

**חישוב:** `calculateSubscriptionsContribution` – רק מנויים פעילים בחודש (`subscription_start_date`, `subscription_end_date`).

---

## 4. פירוט חיוב (getBillingBreakdown)

**קריאה:** `getBillingBreakdown(client, studentId, monthKey)`

**שיעורים:** 
```
OR({billing_month} = "monthKey", FIND("monthKey", {billing_month}) = 1)
```

**בעיה אפשרית:** אין fallback ל-`start_datetime` (בשונה מהמנוע). שיעורים בלי `billing_month` לא יופיעו בפירוט.

**ביטולים:** `AND(..., {billing_month} = "monthKey" או FIND)`  
**מנויים:** ללא פילטר חודש – מנותחים לפי תאריכי הפעילות.

---

## 5. נקודות קריטיות לסינון לפי חודש

| שלב | קובץ | פילטר חודש |
|-----|------|-------------|
| טעינת רשימת חיובים | billingService.getChargesReport | `buildFilterFormula` – חודש חיוב |
| יצירת חיוב | billingEngine.buildMonthForAllActiveStudents | `billingMonth` כפרמטר יחיד |
| שיעורים ליצירה | billingEngine | `OR(billing_month, start_datetime)` |
| שיעורים בחישוב | billingRules.calculateLessonsContribution | `belongsToMonth` |
| ביטולים | billingEngine + billingRules | `billing_month` בלבד |
| פירוט | billingDetailsService.getBillingBreakdown | `billing_month` / FIND בלבד |

---

## 6. מה עלול לגרום לנתונים מחודשים אחרים?

1. **`billing_month` שגוי/ריק** בשיעורים או בביטולים  
2. **ביטולים ללא `billing_month`** – לא נכללים בפילטר של המנוע  
3. **Fallback לפי `start_datetime`** – שיעורים ללא `billing_month` אבל עם תאריך בחודש ייכללו  
4. **תאימות פורמט** – אם `חודש חיוב` בטבלת חיובים הוא Date ויש חריגות, התאמת חודש/שנה עלולה להחמיץ רשומות

---

## 7. זרימה מלאה (דיאגרמה)

```
[בחר חודש] selectedMonth
        │
        ├──► [הצגת רשימה] getChargesReport(billingMonth=selectedMonth)
        │         └── פילטר: חודש חיוב = selectedMonth
        │
        ├──► [יצירת חיובים] createMonthlyCharges(targetMonth)
        │         └── buildMonthForAllActiveStudents(billingMonth=targetMonth)
        │                   ├── שיעורים: billing_month OR start_datetime בטווח
        │                   ├── ביטולים: billing_month = targetMonth
        │                   ├── מנויים: כל המנויים (חישוב לפי תאריכים)
        │                   └── רשומת חיוב: 'חודש חיוב' = targetMonth
        │
        └──► [פירוט חיוב] getBillingBreakdown(studentId, bill.month)
                  └── bill.month = selectedMonth (מהרשומה)
                  └── שיעורים: billing_month / FIND(monthKey)
                  └── ביטולים: billing_month / FIND(monthKey)
```

---

## 8. המלצות לאימות

1. לבדוק ב-Airtable שכל שיעור לחיוב כולל `billing_month` תקין (YYYY-MM).  
2. לבדוק שכל ביטול לחיוב כולל `billing_month` תקין.  
3. לבדוק שהפירוט משתמש ב-`bill.month` (מהרשומת החיוב) ולא בחודש גלובלי אחר.
