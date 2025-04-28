FROM node:22.12-alpine AS builder

# Must be entire project because `prepare` script is run during `npm install` and requires all files.
COPY ./index.ts /index.ts
COPY ./package.json /package.json
COPY tsconfig.json /tsconfig.json

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm npm install

RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit-dev

FROM node:22-alpine AS release

COPY --from=builder /dist /dist
COPY --from=builder /package.json /package.json
COPY --from=builder /package-lock.json /package-lock.json

ENV NODE_ENV=production

WORKDIR /app

RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/index.js"]