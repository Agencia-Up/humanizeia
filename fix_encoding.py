import re

with open('src/components/whatsapp/GlobalLeadsCrm.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the filter parameter from realtime subscriptions
fixed = re.sub(r", filter: `user_id=eq\.\$\{user\.id\}`", '', content)

with open('src/components/whatsapp/GlobalLeadsCrm.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.write(fixed)

# Verify
if ', filter: `user_id=eq.' in fixed:
    print('ERRO: filtro ainda presente!')
else:
    print('Filtro removido com sucesso!')
    
# Check emojis are intact
if '⭐' in fixed or '🌀' in fixed or 'Novo' in fixed:
    print('Emojis/texto OK!')
