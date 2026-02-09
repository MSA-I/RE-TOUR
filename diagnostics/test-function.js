// Test script to call the Edge Function and see the actual error
// Run with: node diagnostics/test-function.js

const SUPABASE_URL = 'https://zturojwgqtjrxwsfbwqw.supabase.co';
const PIPELINE_ID = 'c0d8ac86-8d49-45a8-90e9-8deee01e640f';

// Replace with your actual auth token
const AUTH_TOKEN = 'YOUR_AUTH_TOKEN_HERE';

async function testFunction() {
  console.log('Testing run-space-analysis function...');
  console.log('Pipeline ID:', PIPELINE_ID);
  console.log('');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/run-space-analysis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipeline_id: PIPELINE_ID,
      }),
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    console.log('');

    const contentType = response.headers.get('content-type');
    console.log('Content-Type:', contentType);
    console.log('');

    if (contentType?.includes('application/json')) {
      const data = await response.json();
      console.log('Response Body:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      const text = await response.text();
      console.log('Response Text:');
      console.log(text);
    }
  } catch (error) {
    console.error('Fetch Error:', error.message);
    console.error('Full Error:', error);
  }
}

testFunction();
