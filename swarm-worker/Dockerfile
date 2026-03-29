FROM node:20-alpine

WORKDIR /app

COPY src ./src
COPY package.json ./

ENV ROLE=worker
ENV PORT=44444

EXPOSE 44444

CMD ["node", "src/index.js"]
