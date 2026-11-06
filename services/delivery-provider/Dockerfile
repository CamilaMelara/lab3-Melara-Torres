FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
RUN npm ci
COPY services/delivery-provider ./services/delivery-provider
RUN npx tsc -p services/delivery-provider/tsconfig.json

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/services/delivery-provider/dist ./dist
COPY instrumentation.cjs ./instrumentation.cjs
CMD ["node", "--experimental-loader=@opentelemetry/instrumentation/hook.mjs", "--require", "./instrumentation.cjs", "dist/server.js"]
