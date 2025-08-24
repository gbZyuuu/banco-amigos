# STAGE 1: Build da aplicação
FROM node:18.17.1-alpine AS build

# Cria um usuário não-root para segurança
RUN addgroup -g 1001 -S nodeuser && \
    adduser -u 1001 -S nodeuser -G nodeuser

# Define o diretório de trabalho
WORKDIR /app

# Primeiro copia apenas o package.json
COPY package.json ./

# Instala as dependências para gerar o package-lock.json
RUN npm install

# Copia o resto dos arquivos necessários
COPY vite.config.js ./
COPY src ./src
COPY index.html ./

# Altera as permissões para o usuário não-root
RUN chown -R 1001:0 /app

# Muda para o usuário não-root
USER 1001

# Constrói a aplicação
RUN npm run build

# STAGE 2: Serviço final
FROM nginx:1.25.2-alpine

# Copia os arquivos de build do estágio anterior
COPY --from=build /app/dist /usr/share/nginx/html

# Configuração do NGINX para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expõe a porta 80
EXPOSE 80

# Inicia o NGINX
CMD ["nginx", "-g", "daemon off;"]
