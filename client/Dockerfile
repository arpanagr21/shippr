FROM node:20-alpine

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

COPY . .

EXPOSE 5173

CMD ["yarn", "dev"]
