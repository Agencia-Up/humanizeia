const fs = require('fs');
const file = 'e:\\Projetos - Antigravity\\HUMANIZEIA\\humanizeia\\supabase\\functions\\uazapi-webhook\\index.ts';
let content = fs.readFileSync(file, 'utf8');

const search = `      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
        msgObj = payload.data[0]
      }
        msgObj = payload.message
      }`;
const replace = `      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
        msgObj = payload.data[0]
      }`;
content = content.replace(search, replace);

const searchCRLF = `      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {\r\n        msgObj = payload.data[0]\r\n      }\r\n        msgObj = payload.message\r\n      }`;
const replaceCRLF = `      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {\r\n        msgObj = payload.data[0]\r\n      }`;
content = content.replace(searchCRLF, replaceCRLF);

fs.writeFileSync(file, content);
console.log('Fixed syntax error');
