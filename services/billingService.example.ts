/**
 * Example usage of Billing Service
 * 
 * This file demonstrates how to use the billing service to generate monthly bills.
 * It can be integrated into your existing API endpoints or run as a standalone script.
 */

import { AirtableClient } from './airtableClient';
import { generateMonthlyBill, generateAllMonthlyBills, validateBillingFields } from './billingService';
import { nexusApi } from './nexusApi';

/**
 * Example: Generate monthly bill for a single student
 */
export async function exampleGenerateSingleBill() {
  const client = new AirtableClient();
  
  // Validate fields first
  const missingFields = await validateBillingFields(client);
  if (missingFields) {
    console.error('Missing required fields:', JSON.stringify({ MISSING_FIELDS: missingFields }, null, 2));
    return;
  }

  // Fetch data
  const { students } = await nexusApi.getStudents();
  const lessons = await nexusApi.getLessons('2024-03-01T00:00:00', '2024-03-31T23:59:59');
  const subscriptions = await nexusApi.getSubscriptions();

  // Generate bill for first student
  const student = students[0];
  const billingMonth = '2024-03';
  
  const bill = await generateMonthlyBill(
    client,
    student.id,
    student.name,
    billingMonth,
    lessons,
    subscriptions
  );

  console.log('Generated bill:', bill);
}

/**
 * Example: Generate monthly bills for all students
 */
export async function exampleGenerateAllBills() {
  const client = new AirtableClient();
  
  // Validate fields
  const missingFields = await validateBillingFields(client);
  if (missingFields) {
    console.error('Missing required fields:', JSON.stringify({ MISSING_FIELDS: missingFields }, null, 2));
    return;
  }

  // Fetch data
  const { students } = await nexusApi.getStudents();
  const lessons = await nexusApi.getLessons('2024-03-01T00:00:00', '2024-03-31T23:59:59');
  const subscriptions = await nexusApi.getSubscriptions();

  // Generate bills for all students
  const billingMonth = '2024-03';
  const bills = await generateAllMonthlyBills(
    client,
    billingMonth,
    lessons,
    subscriptions,
    students.map(s => ({ id: s.id, name: s.name }))
  );

  console.log(`Generated ${bills.length} bills`);
  console.log('Total amount:', bills.reduce((sum, b) => sum + b.totalAmount, 0));
}

/**
 * Example: API endpoint integration (for serverless/API route)
 */
export async function apiGenerateBills(billingMonth: string) {
  const client = new AirtableClient();
  
  try {
    // Validate fields
    const missingFields = await validateBillingFields(client);
    if (missingFields) {
      return {
        error: 'MISSING_FIELDS',
        data: { MISSING_FIELDS: missingFields },
      };
    }

    // Fetch data for the billing month
    const startDate = `${billingMonth}-01T00:00:00`;
    const endDate = `${billingMonth}-31T23:59:59`;
    
    const { students } = await nexusApi.getStudents();
    const lessons = await nexusApi.getLessons(startDate, endDate);
    const subscriptions = await nexusApi.getSubscriptions();

    // Generate bills
    const bills = await generateAllMonthlyBills(
      client,
      billingMonth,
      lessons,
      subscriptions,
      students.map(s => ({ id: s.id, name: s.name }))
    );

    return {
      success: true,
      count: bills.length,
      bills,
      total: bills.reduce((sum, b) => sum + b.totalAmount, 0),
    };
  } catch (error: any) {
    if (error.MISSING_FIELDS) {
      return {
        error: 'MISSING_FIELDS',
        data: error,
      };
    }
    
    return {
      error: 'BILLING_ERROR',
      message: error.message || 'Failed to generate bills',
    };
  }
}

/**
 * Example: Check if billing fields are configured correctly
 */
export async function exampleValidateFields() {
  const client = new AirtableClient();
  const missingFields = await validateBillingFields(client);
  
  if (missingFields) {
    console.log('Missing fields detected:');
    console.log(JSON.stringify({ MISSING_FIELDS: missingFields }, null, 2));
    return false;
  }
  
  console.log('All required fields are present!');
  return true;
}
