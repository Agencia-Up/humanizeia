import os

file_path = 'src/components/whatsapp/GlobalLeadsCrm.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = {
    '­ƒö░': '✨',
    '­ƒæÇ': '👀',
    '­ƒÄ»': '🎯',
    '­ƒñØ': '🤝',
    '­ƒÜ½': '🚫',
    '­ƒåò': '📥',
    '­ƒæñ': '👤',
    '├¡': 'í',
    '├ú': 'ã',
    '├í': 'á',
    '├¬': 'ê',
    '├│': 'ó',
    '├┤': 'ô',
    '├º': 'ç',
    'ÔÇö': '—',
    'ÔåÆ': '→'
}

for bad, good in replacements.items():
    content = content.replace(bad, good)

with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('Caracteres corrompidos corrigidos com sucesso!')
