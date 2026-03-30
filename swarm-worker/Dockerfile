FROM node:20-alpine

WORKDIR /app

COPY src /app/src

ENV PORT=44444
ENV WORKER_PATH=/app/worker
ENV UPDATE_URL=https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json

EXPOSE 44444

CMD ["node", "src/index.js"]
