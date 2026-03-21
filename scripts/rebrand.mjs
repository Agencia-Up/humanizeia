import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('./src', (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts') || filePath.endsWith('.css')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content
      .replace(/HumanizeAI TF/g, 'Logos IA')
      .replace(/HumanizeAI/g, 'Logos IA')
      .replace(/humanizeai-logo\.png/g, 'logosia-logo.png');
      
    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log('Modified', filePath);
    }
  }
});
