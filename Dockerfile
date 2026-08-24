FROM node:22-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

WORKDIR /app

RUN mkdir -p /data && chown node:node /data

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY website ./website
COPY eng.traineddata ./eng.traineddata

USER node

EXPOSE 8080

CMD ["npm", "run", "website:start"]
