
const fs = require('fs');

const payload = JSON.parse(fs.readFileSync('last_payload.json', 'utf8'));
const b64 = payload.content.JPEGThumbnail;

if (b64) {
  const buffer = Buffer.from(b64, 'base64');
  console.log(`Thumbnail encontrada! Tamanho do buffer: ${buffer.length} bytes`);
  fs.writeFileSync('thumb.jpg', buffer);
  console.log('Salvo em thumb.jpg');
} else {
  console.log('Sem JPEGThumbnail no payload.');
}
