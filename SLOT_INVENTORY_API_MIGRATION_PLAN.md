# Slot Inventory API Migration Plan

## בעיה נוכחית

הקוד הנוכחי קורא ישירות ל-Airtable מהפרונט דרך `nexusApi.getSlotInventory()`, מה שגורם לבעיות בפרודקשן:
- API key חשוף בפרונט
- אין שליטה מרכזית על הקריאות
- לא עובד בפרודקשן

## מצב נוכחי

### קריאות ישירות ל-Airtable מהפרונט:
1. **`components/Availability.tsx`** - קורא ל-`getSlotInventory()` מ-`data/resources/slotInventory.ts` → `nexusApi.getSlotInventory()` → ישירות ל-Airtable
2. **`components/Calendar.tsx`** - קורא ל-`getSlotInventory()` מ-`data/resources/slotInventory.ts` → `nexusApi.getSlotInventory()` → ישירות ל-Airtable
3. **`hooks/useOpenSlotModal.ts`** - קורא ישירות ל-`nexusApi.getSlotInventory()`

### מה צריך לשמור:
- ✅ Deduplication logic (natural_key + composite key)
- ✅ Status mapping (Hebrew ↔ English)
- ✅ forceRefresh mechanism
- ✅ Cache invalidation
- ✅ Pagination handling
- ✅ Teacher filtering

## פתרון

### שלב 1: יצירת API Endpoint ב-apiServer.ts
- **GET /api/slot-inventory** - לקבלת slot inventory
- Query params: `start`, `end`, `teacherId` (optional)
- מחזיר את אותו פורמט כמו `nexusApi.getSlotInventory()`

### שלב 2: עדכון הפרונט
- יצירת wrapper ב-`services/nexusApi.ts` שקורא ל-API server במקום ישירות ל-Airtable
- שמירה על אותו interface כדי לא לשבור את הקוד הקיים
- שימוש ב-`VITE_API_BASE_URL` אם קיים, אחרת fallback ל-localhost

### שלב 3: בדיקה
- בדיקה שהכל עובד דרך ה-API server
- בדיקה שהפיצרים נשמרו (deduplication, cache, etc.)
