FROM node:20-slim

WORKDIR /app

COPY worker /app/worker
COPY worker-start.sh /app/worker-start.sh

ENV PORT=44444
ENV WORKER_PATH=/app/worker
ENV UPDATE_URL=https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json

RUN chmod +x /app/worker-start.sh /app/worker

EXPOSE 44444

CMD ["/app/worker-start.sh"]
