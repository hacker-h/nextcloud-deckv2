FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BUILD_SHA
ENV BUILD_SHA=$BUILD_SHA
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
