FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
USER node
CMD ["node", "server.js"]
