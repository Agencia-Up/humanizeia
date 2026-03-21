import fs from 'fs';
import path from 'path';

if (fs.existsSync('public/logosia-logo.png')) {
    fs.renameSync('public/logosia-logo.png', 'public/logosia-brand.png');
}

function replaceStr(file) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        let newContent = content.replace(/logosia-logo\.png/g, 'logosia-brand.png');
        if (content !== newContent) {
            fs.writeFileSync(file, newContent, 'utf8');
            console.log('Updated:', file);
        }
    }
}

replaceStr('index.html');

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walkDir(p);
    else if (p.endsWith('.tsx') || p.endsWith('.ts') || p.endsWith('.css') || p.endsWith('.html') || p.endsWith('.md')) replaceStr(p);
  });
}
walkDir('./src');
walkDir('./public');
