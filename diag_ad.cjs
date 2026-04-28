
// diag_ad.cjs - Diagnóstico de extração de anúncio do Facebook
// Roda: node diag_ad.cjs
const https = require('https');
const http = require('http');
const fs = require('fs');

const TEST_URL = 'https://www.facebook.com/story.php?story_fbid=122108146508778887&id=61573366625223';
// Testa também o formato fb.me
const TEST_URL2 = 'https://fb.me/9zkKM2Zl7';

function fetchHtml(url, followRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      }
    };
    const req = lib.request(options, (res) => {
      console.log(`  Status: ${res.statusCode}`);
      console.log(`  Content-Type: ${res.headers['content-type']}`);
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && followRedirects > 0) {
        const redirectUrl = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        console.log(`  Redirect → ${redirectUrl}`);
        res.resume();
        return resolve(fetchHtml(redirectUrl, followRedirects - 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ html: data, finalUrl: url, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function extractMeta(html, prop) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  }
  return null;
}

async function testUrl(url) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testando URL: ${url}`);
  console.log('='.repeat(60));

  try {
    const result = await fetchHtml(url);
    const html = result.html;
    console.log(`  HTML recebido: ${html.length} bytes`);

    const ogTitle = extractMeta(html, 'og:title');
    const ogDesc = extractMeta(html, 'og:description');
    const ogImage = extractMeta(html, 'og:image');

    console.log(`\n  📌 og:title: ${ogTitle || '(vazio)'}`);
    console.log(`  📝 og:description: ${ogDesc ? ogDesc.substring(0, 120) : '(vazio)'}`);
    console.log(`  🖼️  og:image: ${ogImage ? ogImage.substring(0, 100) : '(vazio)'}`);

    if (ogImage) {
      console.log(`\n  ▶ Tentando baixar a imagem og:image...`);
      try {
        const imgResult = await fetchHtml(ogImage);
        console.log(`  ✅ Imagem acessível! ${imgResult.html.length} bytes`);
        // Salva os primeiros bytes para confirmar que é uma imagem
        const buf = Buffer.from(imgResult.html, 'binary');
        fs.writeFileSync('diag_ad_image.bin', buf);
        console.log(`  💾 Imagem salva em diag_ad_image.bin`);
      } catch (imgErr) {
        console.log(`  ❌ Erro ao baixar imagem: ${imgErr.message}`);
      }
    } else {
      console.log(`\n  ⚠️ Sem og:image. Verificando conteúdo HTML (primeiros 2000 chars):`);
      console.log(html.substring(0, 2000));
    }
  } catch (err) {
    console.log(`  ❌ ERRO: ${err.message}`);
  }
}

async function main() {
  await testUrl(TEST_URL);
  await testUrl(TEST_URL2);
}

main().catch(console.error);
