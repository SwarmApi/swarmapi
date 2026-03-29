FROM node:20-alpine

WORKDIR /app
COPY swarm.js package.json ./

# 默认作为Worker
ENV ROLE=worker
ENV PORT=44444
ENV ENCRYPT_KEY=swarm-default-key-2026

EXPOSE 44444

CMD ["node", "swarm.js"]
