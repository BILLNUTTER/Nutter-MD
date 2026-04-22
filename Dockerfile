FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq > /dev/null 2>&1 \
    && apt-get install -y -qq --no-install-recommends \
        ca-certificates \
        git \
        python3 \
        make \
        g++ \
        libssl-dev \
        > /dev/null 2>&1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV GIT_SSL_NO_VERIFY=true
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global http.sslVerify false

# Install pnpm globally
RUN npm install -g pnpm --loglevel=error --no-fund --no-audit

# Copy ALL package.json files from every workspace package before pnpm install
# so pnpm can resolve all local workspace dependencies (including lib/* packages)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/nutter-xmd/package.json ./artifacts/nutter-xmd/

# Copy lib/* package.json files — these are workspace packages that api-server depends on
# (e.g. lib/api-zod needs zod, lib/api-client-react needs @tanstack/react-query, etc.)
# We copy the entire lib directory structure so pnpm resolves all local deps correctly
COPY lib/ ./lib/

# Install all dependencies including workspace libs
RUN pnpm install --frozen-lockfile --prod=false

# Copy remaining source files
COPY . .

# Build ONLY the api-server (bot backend) from source.
# The nutter-xmd frontend dist is committed to the repo and used as-is.
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
