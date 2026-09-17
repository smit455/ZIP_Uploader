FROM php:8.3-fpm

RUN apt-get update \
    && apt-get install -y --no-install-recommends libzip-dev \
    && docker-php-ext-install pdo_mysql zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY php.ini /usr/local/etc/php/conf.d/zz-uploader.ini
COPY . /var/www/html

RUN mkdir -p /var/www/html/storage/uploads \
    && chmod -R 777 /var/www/html/storage

CMD ["php-fpm", "-F"]
