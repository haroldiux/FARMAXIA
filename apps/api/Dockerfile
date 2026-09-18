FROM node:22-alpine

ENV COREPACK_HOME=/corepack
ENV PATH=/corepack:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @farmaxia/api build

ENV NODE_ENV=production
EXPOSE 3001

WORKDIR /workspace/apps/api
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
