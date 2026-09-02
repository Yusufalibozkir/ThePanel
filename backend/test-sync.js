const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/sync/shopify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

console.log('Testing sync endpoint...\n');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Response: ${data}\n`);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.end();
