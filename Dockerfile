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

RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

RUN npm install --loglevel=error --no-fund --no-audit \
    @whiskeysockets/baileys@7.0.0-rc.9 \
    thread-stream@3.1.0

COPY artifacts/api-server/dist ./artifacts/api-server/dist

ENV NODE_ENV=production

CMD ["node", "artifacts/api-server/dist/index.mjs"]
