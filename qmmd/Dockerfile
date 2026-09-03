# Build qmmd (Intel GPU metrics Prometheus daemon)
FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev pkgconfig eudev-dev
RUN cargo install --locked qmmd --root /usr/local

FROM alpine:3.20
RUN apk add --no-cache libgcc eudev-libs tini \
  && addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /usr/local/bin/qmmd /usr/local/bin/qmmd
USER appuser
ENV RUST_LOG=info
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:9101/metrics || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["qmmd", "-f", "-p", "9101", "-m", "1000"]
