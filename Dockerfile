# Estágio 1: Build
FROM node:20-alpine AS build
WORKDIR /app

# Instala as dependências primeiro (otimização de cache do Docker)
COPY package*.json ./
RUN npm ci

# Copia o resto do código
COPY . .

# Recebe as variáveis preenchidas no Easypanel (via --build-arg)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_SUPABASE_PUBLISHABLE_KEY

# Repassa para o ambiente para o Vite enxergar durante o build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

# Compila o site para a pasta dist/
RUN npm run build:prod

# Estágio 2: Produção (Servidor Web Nginx super rápido e leve)
FROM nginx:alpine

# Copia os arquivos compilados do Estágio 1 para a pasta do Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Manda a nossa configuração especial para o React Router funcionar
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
