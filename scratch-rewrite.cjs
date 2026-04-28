const fs = require('fs');

const path = 'e:\\Projetos - Antigravity\\HUMANIZEIA\\humanizeia\\supabase\\functions\\uazapi-webhook\\index.ts';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(/\r\n/g, '\n');

// 1. REWRITE sendUazapiImageMessage
const s1 = code.indexOf('async function sendUazapiImageMessage(');
const e1 = code.indexOf('async function sendUazapiCarouselMessage(');

const newImgFn = `async function sendUazapiImageMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, imageUrl: string, caption?: string, vehicleLabel?: string) {
  const attempts = [
    { label: 'send-media-number', url: \`\${baseUrl}/send/media\`, body: { number: phoneNumber, media: imageUrl, mediatype: 'image', caption: caption || '', readchat: true, delay: 0 } },
    { label: 'send-media-remotejid', url: \`\${baseUrl}/send/media\`, body: { remoteJid, media: imageUrl, mediatype: 'image', caption: caption || '' } },
    { label: 'message-sendMedia', url: \`\${baseUrl}/message/sendMedia\`, body: { number: phoneNumber, mediaMessage: { mediatype: 'image', media: imageUrl, caption: caption || '' }, options: { delay: 200 } } },
    { label: 'message-sendMedia-instance', url: \`\${baseUrl}/message/sendMedia/\${instanceName}\`, body: { number: phoneNumber, mediaMessage: { mediatype: 'image', media: imageUrl, caption: caption || '' }, options: { delay: 200 } } }
  ];

  for (const attempt of attempts) {
    try {
      console.log(\`[Webhook] Tentando imagem via \${attempt.label}\`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body)
      });
      const txt = await res.text().catch(() => '');
      console.log(\`[Webhook] UAZAPI \${attempt.label} -> \${res.status} | \${txt.substring(0, 150)}\`);
      if (res.ok) return { ok: true, label: attempt.label, status: res.status };
    } catch (err) {
      console.error(\`[Webhook] Erro imagem \${attempt.label}:\`, err);
    }
  }
  return { ok: false };
}

`;
if (s1 !== -1 && e1 !== -1) {
  code = code.substring(0, s1) + newImgFn + code.substring(e1);
}

// 2. REWRITE sendUazapiTextMessage
const s2 = code.indexOf('async function sendUazapiTextMessage(');
const e2 = code.indexOf('async function processMessage(');
const newTxtFn = `async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    { label: 'send-text-number', url: \`\${baseUrl}/send/text\`, body: { number: phoneNumber, text } },
    { label: 'send-text-instance', url: \`\${baseUrl}/send/text?instance=\${instanceName}\`, body: { number: phoneNumber, text } },
    { label: 'send-text-remotejid', url: \`\${baseUrl}/send/text\`, body: { remoteJid, text } }
  ];
  for (const attempt of attempts) {
    try {
      console.log(\`[Webhook] sendText via \${attempt.label} -> \${phoneNumber}\`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body)
      });
      const txt = await res.text().catch(() => '');
      console.log(\`[Webhook] UAZAPI \${attempt.label} -> \${res.status} | \${txt.substring(0, 150)}\`);
      if (res.ok) return { ok: true, label: attempt.label, status: res.status, body: txt };
    } catch (err) {
      console.error(\`[Webhook] Erro sendText \${attempt.label}:\`, err);
    }
  }
  return { ok: false };
}

`;
if (s2 !== -1 && e2 !== -1) {
  code = code.substring(0, s2) + newTxtFn + code.substring(e2);
}

// 3. REMOVE links fallback
const linksStartStr = '      const linksMessage = buildBndvPhotoLinksMessage(';
let lsIdx = code.indexOf(linksStartStr);
if (lsIdx !== -1) {
  let prevOkEnd = code.lastIndexOf('      }', lsIdx) + 8; // end of carouselRes.ok block
  let returnFailStart = code.indexOf('      return {\\n        success: false,\\n        error: \\\'Encontrei as fotos', lsIdx);
  if (returnFailStart === -1) {
    returnFailStart = code.indexOf('      return {\n        success: false,\n        error: \'Encontrei as fotos', lsIdx);
  }
  if (returnFailStart !== -1) {
    code = code.substring(0, prevOkEnd) + '\\n' + code.substring(returnFailStart);
    code = code.replace(/\\n/g, '\n');
  }
}

// FIX fetching headers
code = code.replace(
  \`    const res = await fetch(mediaUrl, {
      headers: {
        'token': instKey,
        'apikey': instKey,
      },\`,
  \`    const isExt = !mediaUrl.includes('uazapi') && !mediaUrl.includes('evolution');
    const res = await fetch(mediaUrl, { headers: isExt ? {} : { 'token': instKey, 'apikey': instKey },\`
);
code = code.replace(
  \`    const res = await fetch(mediaUrl, {
      headers: {
        'token': instKey,
        'apikey': instKey,
      },\`,
  \`    const isExt = !mediaUrl.includes('uazapi') && !mediaUrl.includes('evolution');
    const res = await fetch(mediaUrl, { headers: isExt ? {} : { 'token': instKey, 'apikey': instKey },\`
);

code = code.replace(/\\n/g, '\\r\\n');
fs.writeFileSync(path, code);
console.log('DONE');
