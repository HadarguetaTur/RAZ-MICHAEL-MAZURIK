# Billing Engine Tests

Jest unit tests for the billing engine.

## Test Files

- **`billingRules.test.ts`**: Tests pure calculation functions (no Airtable)
- **`billingEngine.test.ts`**: Tests orchestration logic (with mocked AirtableClient)

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Test Scenarios Covered

### billingRules.test.ts

1. ✅ **Scenario 1**: Student with 4 private lessons => lessons_total = 700
2. ✅ **Scenario 2**: Student with 2 pair lessons and NO subscription => lessons_total = 0, subscriptions_total = 0
3. ✅ **Scenario 3**: Student with 2 pair lessons and active subscription monthly_amount=300 => total = 300
4. ✅ **Scenario 4**: Cancellation >=24h => cancellation not billable => total unaffected
5. ✅ **Scenario 5**: <24h cancellation with is_charged=false => pending_approval status, not included in total
6. ✅ **Scenario 6**: <24h cancellation with is_charged=true and charge=175 => included
7. ✅ **Scenario 7**: Group lessons never add per-lesson charges (0), subscription only
8. ✅ **Timezone boundaries**: Month boundary tests with Asia/Jerusalem considerations

### billingEngine.test.ts

8. ✅ **Scenario 8**: Duplicate Billing records => DUPLICATE_BILLING_RECORDS thrown

## Additional Test Coverage

- Multi-student lessons (private, pair, group)
- Cancellations without linked lesson
- Subscription date boundaries
- Currency string parsing
- Helper functions (isLessonExcluded, isPrivateLesson, etc.)
- Edge cases (empty arrays, null values, etc.)

## Notes

- All tests use pure functions (no Airtable API calls)
- billingEngine tests use mocked AirtableClient
- Timezone tests verify month boundary logic (production should use timezone library)
- Tests are deterministic and isolated
