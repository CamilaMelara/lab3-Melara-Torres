FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
RUN npm install
COPY services/delivery-provider ./services/delivery-provider
RUN npx tsc -p services/delivery-provider/tsconfig.json

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/services/delivery-provider/dist ./dist
CMD ["node", "dist/server.js"]
