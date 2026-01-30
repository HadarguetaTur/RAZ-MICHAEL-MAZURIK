import { AirtableClient } from './services/airtableClient.js';

async function run() {
  const client = new AirtableClient();
  const tableId = 'tblyEsDpiRkw8doxQ'; // monthlyBills from fieldMap.ts
  try {
    const records = await client.getRecords(tableId, { maxRecords: 1 });
    if (records.length > 0) {
      console.log('Fields in monthlyBills table:');
      console.log(JSON.stringify(Object.keys(records[0].fields), null, 2));
      console.log('\nSample record values:');
      console.log(JSON.stringify(records[0].fields, null, 2));
    } else {
      console.log('No records found in monthlyBills table.');
    }
  } catch (error) {
    console.error('Error fetching records:', error);
  }
}

run();
