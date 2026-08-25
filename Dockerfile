FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PULSE_WEB_DIR=/app/web PULSE_DATA_DIR=/data
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev
COPY packages/shared/scenario.schema.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist ./web
EXPOSE 7100
VOLUME /data
CMD ["node", "packages/server/dist/index.js"]
