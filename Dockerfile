# Estágio 1: Build
# Digest pinning pra reprodutibilidade + reduzir round-trips ao Docker Hub
# (resolve auth 404 transiente que quebrou builds em 28/05/2026 14:34 GMT).
# Atualizar este digest manualmente quando quiser bumpar node:20-alpine.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
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
# Digest pinning (mesma motivação do estágio 1).
FROM nginx:alpine@sha256:8b1e78743a03dbb2c95171cc58639fef29abc8816598e27fb910ed2e621e589a

# Copia os arquivos compilados do Estágio 1 para a pasta do Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Manda a nossa configuração especial para o React Router funcionar
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
