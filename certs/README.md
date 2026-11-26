# Российские корневые сертификаты

Нужны, потому что часть российских API (например, эквайринг Т-Банка и порталы
госуслуг) подписывает TLS сертификатами от Минцифры, а стандартный набор
корней в Node их не содержит. Симптом — безобидный на вид
`fetch failed`, а внутри `SELF_SIGNED_CERT_IN_CHAIN`.

## Как это работает

**Образ.** `Dockerfile` копирует папку `certs/` и собирает
`/app/certs/ca-bundle.pem`: системные корни из `/etc/ssl/certs/ca-certificates.crt`
плюс всё из `certs/russian/` и `certs/russian-server/`. Переменная
`NODE_EXTRA_CA_CERTS` указывает на этот файл, поэтому Node доверяет
российским корням во всех запросах — и в приложении, и в maintenance.

`NODE_EXTRA_CA_CERTS` **дополняет** стандартный набор, а не заменяет его.

**Деплой.** `deploy/production.sh` перед сборкой складывает сертификаты с
сервера из `/etc/bitebalance/russian-ca/` в `certs/russian-server/`
(папка в git не входит), проверяет, что каждый файл — PEM, и после запуска
кандидата проверяет реальный TLS-хендшейк до банка. Если проверка не прошла,
деплой останавливается до переключения трафика — старый слот продолжает работать.

## Добавить сертификат

Только когда проверка падает с ошибкой сертификата:

```bash
docker exec bitebalance-app-green node -e "fetch('https://securepay.tinkoff.ru/v2/Init',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>console.log('HTTP',r.status)).catch(e=>console.log('ERR',(e.cause&&e.cause.code)||e.message))"
# ERR SELF_SIGNED_CERT_IN_CHAIN  ← нужен российский корень
```

1. Скачать корневые сертификаты с <https://www.gosuslugi.ru/crt>.
2. Если файл в DER (`.cer`), перевести в PEM:
   `openssl x509 -inform DER -in file.cer -out file.crt`
3. Положить в `certs/russian/` (в git — если сертификат общий) или в
   `/etc/bitebalance/russian-ca/` на сервере — тогда он попадёт в образ при
   ближайшем деплое, но останется вне репозитория.
4. Запустить `./deploy/production.sh`.

Сертификаты с сервера держите в `/etc/bitebalance/russian-ca/`, а не в
`certs/russian/`: скопированный в репозиторий файл начнёт мешать `git pull`,
когда тот же файл появится в коммите.
