const fs = require('fs');
let lines = fs.readFileSync('GlobalLeadsCrm.tsx', 'utf-8').split('\n');
for(let i=0; i<lines.length; i++) {
  if(lines[i].includes('postgres_changes') && lines[i].includes('filter:')) {
    let b = String.fromCharCode(96);
    lines[i] = lines[i].replace(', filter: ' + b + 'user_id=eq.${user.id}' + b, '');
  }
}
fs.writeFileSync('GlobalLeadsCrm.tsx', lines.join('\n'), 'utf-8');
