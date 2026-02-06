# תיקון תצוגת חיובים ומיפוי שדות

## כלל מיפוי (מקור האמת)

- **המחיר הסופי (סה"כ לתשלום)** נמצא בשדה: **`כולל מע"מ ומנויים (from תלמיד)`**
- יש לקרוא את סה"כ לתשלום **תמיד** משדה זה, ולא משדות אחרים (לא `total_amount` ולא Lookup אחר).

---

## 1. תיקון פריסת הטבלה (colSpan)

ב-[components/Billing.tsx](components/Billing.tsx) לטבלה יש 8 עמודות אבל שורות "טוען..." ו-"אין חיובים" משתמשות ב-`colSpan={6}`.

- **שינוי:** להחליף את שני המופעים (שורות 630, 632) ל-**`colSpan={8}`**.

---

## 2. תיקון מיפוי סה"כ לתשלום

### 2.1 מקור הבעיה

ב-[services/billingService.ts](services/billingService.ts) ב-`getChargesReport`:
- כרגע: `totalAmount = fields.total_amount || extractNumericValue(record, lookupFields.totalAmountField)`.
- אם יש בבסיס שדה בשם `total_amount` (שנכתב על ידי המנוע) ו**במקביל** Lookup "כולל מע"מ ומנויים (from תלמיד)" – עלול להיקרא הערך הלא נכון.
- בנוסף, ב-`discoverLookupFields` ה-total מזוהה לפי `find()` על רשימת שדות – אם יש כמה שדות דומים, עלול להיבחר לא "כולל מע"מ ומנויים (from תלמיד)".

### 2.2 כיוון תיקון

- **להגדיר שסה"כ לתשלום נגזר רק מ-"כולל מע"מ ומנויים (from תלמיד)".**
- ב-`getChargesReport` בעת חישוב `totalAmount`:
  1. לנסות קודם את השדה הקבוע: **`כולל מע"מ ומנויים (from תלמיד)`** (למשל `extractNumericValue(record, 'כולל מע"מ ומנויים (from תלמיד)')` או שם השדה מקונפיג).
  2. רק אם אין ערך (undefined/null) – fallback ל-`lookupFields.totalAmountField` (discovery) או ל-`fields.total_amount`.
- עדיף **לא** להסתמך על `fields.total_amount` כעדיפות ראשונה אם בבסיס המחיר הסופי האמיתי נמצא רק ב-Lookup "כולל מע"מ ומנויים (from תלמיד)".

### 2.3 fieldMap (אופציונלי)

ב-[contracts/fieldMap.ts](contracts/fieldMap.ts) בטבלת `monthlyBills`: אם רוצים מקור אחד לאמת, אפשר להוסיף מפתח לוגי שמצביע במפורש לשדה הזה, למשל:
- `total_amount_from_student: 'כולל מע"מ ומנויים (from תלמיד)'`
ולהשתמש בו בקריאת הדוחות.

---

## 3. לוגיקת SMART RECOVERY ב-nexusApi

ב-[services/nexusApi.ts](services/nexusApi.ts) (שורות 2394–2407) יש היוריסטיקה שמחליפה בין total ל-subscriptions כש-`totalAmount + adjustmentAmount ≈ subscriptionsAmount`. זה עלול לגרום להצגת מנוי כסה"כ.

- **המלצה:** להסיר את בלוק ה-swap (החלק שמשנה `subscriptionsAmount = subtotal - lessonsAmount` ומשנה `totalAmount`), או לצמצם לוגיקה רק לחישוב total כש-הוא 0. כך סה"כ לתשלום יישאר הערך שנקרא מ-"כולל מע"מ ומנויים (from תלמיד)" בלי החלפות.

---

## סיכום שינויים

| קובץ | שינוי |
|------|--------|
| [components/Billing.tsx](components/Billing.tsx) | `colSpan={6}` → `colSpan={8}` (2 מופעים). |
| [services/billingService.ts](services/billingService.ts) | קריאת סה"כ לתשלום **תמיד** מ-"כולל מע"מ ומנויים (from תלמיד)" (עדיפות ראשונה), ורק אחר כך fallback. |
| [services/nexusApi.ts](services/nexusApi.ts) | הסרה/צמצום SMART RECOVERY שמחליף בין total ל-subscriptions. |
| [contracts/fieldMap.ts](contracts/fieldMap.ts) | (אופציונלי) הוספת מפתח לשדה "כולל מע"מ ומנויים (from תלמיד)" לשימוש אחיד. |
