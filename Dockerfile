FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

EXPOSE 1080

CMD ["node", "server.js"]

# LATEST: docker buildx build --platform linux/amd64 -t zacvaughndev/tus-express-server:v2 --push .