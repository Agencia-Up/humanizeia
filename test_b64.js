const fs = require('fs');
const buf = fs.readFileSync('diag_ad_image.bin');
const uint8 = new Uint8Array(buf);
let binary = '';
for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
const b64 = btoa(binary);
console.log('Base64 length:', b64.length);
