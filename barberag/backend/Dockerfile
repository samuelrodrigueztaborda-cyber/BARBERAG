# backend/Dockerfile
FROM node:18-alpine

WORKDIR /app

# Instala dependencias primero (aprovecha el caché de capas de Docker)
COPY package*.json ./
RUN npm install --omit=dev

# Copia el resto del código
COPY . .

# mysqldump/mysql cliente, para que backup.sh y restore.sh funcionen dentro del contenedor
RUN apk add --no-cache mysql-client bash

EXPOSE 3000

CMD ["node", "server.js"]
