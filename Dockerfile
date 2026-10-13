FROM node:24-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
EXPOSE 8080
# The data volume mounts as root; hand it to the unprivileged node user, then drop privileges
CMD ["sh", "-c", "mkdir -p /data && chown node:node /data && exec su-exec node node server.js"]
