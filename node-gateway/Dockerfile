FROM node:22-alpine

WORKDIR /app

COPY node-gateway/package.json node-gateway/package-lock.json ./
RUN npm ci --omit=dev

COPY node-gateway/src ./src
COPY proto /proto

ENV NODE_ENV=production
ENV PORT=8090
ENV HOST=0.0.0.0
ENV PROTO_PATH=/proto/smm/v1/market.proto
ENV SMM_ENGINE_URL=engine:50051

EXPOSE 8090

USER node

CMD ["node", "src/server.js"]
