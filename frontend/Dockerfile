# Copyright (c) 2026 Intel Corporation
#
# SPDX-License-Identifier: Apache-2.0

# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx ng build --configuration production

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist/pos-simulator/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html
USER appuser
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80 || exit 1
CMD ["nginx", "-g", "daemon off;"]
