
const fs = require('fs');

async function testVision() {
  const b64 = fs.readFileSync('thumb.jpg').toString('base64');
  const OPENAI_API_KEY = 'sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'; // I don't have the key here, it's in Deno.env!
}
