# Test Summary

## All Scenarios Covered ✅

### billingRules.test.ts (Pure Functions)

1. ✅ **Scenario 1**: Student with 4 private lessons => lessons_total = 700, total = 700
2. ✅ **Scenario 2**: Student with 2 pair lessons and NO subscription => lessons_total = 0, subscriptions_total = 0, total = 0
3. ✅ **Scenario 3**: Student with 2 pair lessons and active subscription monthly_amount=300 => total = 300
4. ✅ **Scenario 4**: Cancellation >=24h => cancellation not billable => total unaffected
5. ✅ **Scenario 5**: <24h cancellation with is_charged=false => pending_approval status, cancellation not included in total
6. ✅ **Scenario 6**: <24h cancellation with is_charged=true and charge=175 => included
7. ✅ **Scenario 7**: Group lessons never add per-lesson charges (0), subscription only
8. ✅ **Timezone boundaries**: Month boundary tests with Asia/Jerusalem considerations

### billingEngine.test.ts (Orchestration)

8. ✅ **Scenario 8**: Duplicate Billing records => DUPLICATE_BILLING_RECORDS thrown

## Test Statistics

- **Total test cases**: 30+ tests
- **Pure function tests**: billingRules.test.ts
- **Integration tests**: billingEngine.test.ts (with mocked AirtableClient)
- **Coverage**: All core billing rules and edge cases

## Test Categories

### Lessons Contribution Tests
- 4 private lessons calculation
- Pair/group lessons (0 contribution)
- Cancelled lessons exclusion
- Multi-student lessons handling
- line_amount preference
- billing_month filtering
- Student filtering

### Cancellations Contribution Tests
- >=24h cancellations (not billable)
- <24h with is_charged=false (pending)
- <24h with is_charged=true (included)
- Linked lesson charge calculation
- Missing charge handling
- billing_month filtering

### Subscriptions Contribution Tests
- Active subscription calculation
- Paused subscription exclusion
- Date boundary checks
- Overlapping subscriptions detection
- Currency string parsing
- No end_date handling

### Status Determination Tests
- Paid status
- Pending approval status
- Approved status

### Timezone Boundary Tests
- Start of month
- End of month
- Mid-month boundaries
- Exact boundary dates
- Before/after month

### Helper Function Tests
- isLessonExcluded
- isPrivateLesson
- calculateLessonAmount
- parseMonthlyAmount
- hasMultipleStudents
- getAllStudentIds

## Running Tests

```bash
# Install dependencies first
npm install

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Notes

- All tests are **pure** (no side effects, no Airtable calls)
- billingEngine tests use **mocked AirtableClient**
- Tests are **deterministic** and **isolated**
- Timezone tests verify logic (production should use timezone library for DST)
