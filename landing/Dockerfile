# Хэширование статики: имена файлов меняются при каждом изменении,
# поэтому все видят свежую версию без сброса кэша.
# Контекст сборки — корень EasyFood (см. основной Dockerfile).
FROM node:20-alpine AS assets
WORKDIR /src
COPY landing ./landing
RUN node landing/scripts/hash-static.mjs ./landing

FROM nginx:1.27-alpine
COPY --from=assets /src/landing/deploy/nginx.conf /etc/nginx/conf.d/default.conf
WORKDIR /usr/share/nginx/html
COPY --from=assets /src/landing/. ./
RUN rm -rf preview docs scripts deploy Dockerfile package.json README.md \
    .github .dockerignore .gitignore node_modules .git

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
