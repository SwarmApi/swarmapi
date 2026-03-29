FROM node:20-alpine

WORKDIR /app
COPY queen.js package.json ./

ENV PORT=44444

EXPOSE 44444

CMD ["node", "queen.js"]
