# Estágio 1: Build (Ambiente Node para compilar o código React/Vite)
FROM node:20-alpine as build
WORKDIR /app

# Instala as dependências primeiro (otimização de cache do Docker)
COPY package*.json ./
RUN npm install

# Copia o resto do código
COPY . .

# Variáveis falsas de build (Se não forem preenchidas no Easypanel, o build não quebra)
ENV VITE_SUPABASE_URL=""
ENV VITE_SUPABASE_ANON_KEY=""

# Compila o site para a pasta dist/
RUN npm run build

# Estágio 2: Produção (Servidor Web Nginx super rápido e leve)
FROM nginx:alpine

# Copia os arquivos compilados do Estágio 1 para a pasta do Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Manda a nossa configuração especial para o React Router funcionar
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
