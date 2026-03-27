# PixelPush API

Это доки по API для обработки изображений.

## Начало

Сначала надо зарегаться на сайте pixelpush.io и получить API ключ. Ключ будет вида `pp_live_xxxxxxxxxxxx` для прода и `pp_test_xxxxxxxxxxxx` для теста. Тестовый ключ не надо использовать в продакшене, а продовый на тесте будет реально списывать деньги, так что осторожно. Ключ надо передавать в каждом запросе в заголовке:

```
Authorization: Bearer pp_live_ddw7Fkfjejgdjav
```

## Установка SDK

Можно использовать наш SDK, тогда не надо думать про HTTP запросы.

Для Python:

```
pip install pixelpush
```

Для Node.js:

```
npm install pixelpush-js
```

Можно и без SDK через обычный REST.

## Сжатие изображения

Основная операция. Отправляете картинку, получаете сжатую.

```
POST https://api.pixelpush.io/v1/compress
Content-Type: multipart/form-data
Authorization: Bearer pp_live_xxxxxxxxxxxx
```

Параметры запроса:

- `file` — файл картинки (jpeg, png, gif, webp, avif, tiff, bmp). Обязательный.
- `quality` — качество от 1 до 100. По умолчанию 85.
- `format` — формат вывода: jpeg, png, webp, avif. По умолчанию такой же как входной.
- `width` — ширина результата в пикселях. Если не указать — оригинальная.
- `height` — высота результата в пикселях. Если не указать — оригинальная.
- `keep_metadata` — сохранить EXIF данные (true/false). По умолчанию false. Если у пользователей фотки с геолокацией то НЕ ВКЛЮЧАЙТЕ ЭТО потому что будет утечка персональных данных и вы попадёте под GDPR.

Пример через curl:

```bash
curl -X POST https://api.pixelpush.io/v1/compress \
  -H "Authorization: Bearer pp_live_xxxxxxxxxxxx" \
  -F "file=@photo.jpg" \
  -F "quality=80" \
  -F "format=webp"
```

Ответ:

```json
{
  "id": "img_8f3kd92ms",
  "url": "https://cdn.pixelpush.io/img_8f3kd92ms.webp",
  "original_size": 2048576,
  "compressed_size": 187432,
  "expires_at": "2024-02-15T14:30:00Z"
}
```

Картинка хранится 24 часа, потом удаляется. Если надо дольше — читай раздел про постоянное хранилище ниже.

## Постоянное хранилище

По умолчанию файлы живут 24 часа. Если надо хранить дольше, можно подключить свой S3 или наше облако. Для нашего облака нужен тариф Pro. Для S3 — идёте в настройки аккаунта и добавляете ключи доступа. После этого добавляете параметр `storage=persistent` к любому запросу и файл не удалится.

## Изменение размера

```
POST https://api.pixelpush.io/v1/resize
Authorization: Bearer pp_live_xxxxxxxxxxxx
```

Параметры такие же как у /compress, но `width` или `height` обязательны (хотя бы один). Если указан только один — второй подбирается автоматически чтобы сохранить пропорции.

ВАЖНО: если укажете оба параметра (width и height) без `crop=true`, то картинка может получиться вытянутой или сплюснутой!

Если нужен точный размер с обрезкой — добавьте `crop=true`. Обрезка по умолчанию от центра. Можно поменять через `crop_position`: top, bottom, left, right, center.

## Добавить водяной знак

```
POST https://api.pixelpush.io/v1/watermark
Authorization: Bearer pp_live_xxxxxxxxxxxx
```

Параметры:

- `file` — исходная картинка. Обязательный.
- `watermark` — файл водяного знака (png с прозрачностью). Обязательный.
- `position` — позиция: top-left, top-right, bottom-left, bottom-right, center. По умолчанию bottom-right.
- `opacity` — прозрачность от 0 до 100. По умолчанию 80.
- `scale` — размер знака в % от ширины исходника. По умолчанию 15.

## Пакетная обработка

Если надо обработать много файлов — используйте batch API, это быстрее чем слать по одному.

```
POST https://api.pixelpush.io/v1/batch
Content-Type: application/json
Authorization: Bearer pp_live_xxxxxxxxxxxx
```

Тело запроса — JSON массив операций. Максимум 50 файлов за раз.

```json
{
  "operations": [
    { "file_url": "https://example.com/photo1.jpg", "quality": 80, "format": "webp" },
    { "file_url": "https://example.com/photo2.jpg", "quality": 80, "format": "webp" }
  ]
}
```

Ответ приходит сразу с `job_id`, обработка идёт в фоне:

```json
{
  "job_id": "job_m2k9x1pq",
  "status": "processing",
  "total": 2
}
```

Статус задачи проверяется через:

```
GET https://api.pixelpush.io/v1/batch/job_m2k9x1pq
Authorization: Bearer pp_live_xxxxxxxxxxxx
```

## Ошибки

400 — неправильный запрос, смотрите поле `error` в ответе
401 — нет авторизации или неправильный ключ
403 — нет доступа (например пытаетесь удалить чужой файл)
413 — файл слишком большой (максимум 50 МБ на Free, 500 МБ на Pro)
422 — файл не является поддерживаемым изображением
429 — слишком много запросов, смотрите заголовок Retry-After
500 — ошибка на нашей стороне, попробуйте позже

## Лимиты

Free: 100 запросов в минуту, файлы до 50 МБ, 1 ГБ трафика в месяц
Pro: 1000 запросов в минуту, файлы до 500 МБ, безлемит трафика, постоянное хранилище
Enterprise: пишите на sales@pixelpush.io

Текущие лимиты видно в заголовках ответа:
- `X-RateLimit-Limit` — максимум запросов в минуту
- `X-RateLimit-Remaining` — осталось запросов в текущей минуте
- `X-RateLimit-Reset` — unix timestamp, когда сбросится счётчик

## SDK: Python

```python
from pixelpush import PixelPush

client = PixelPush(api_key="pp_live_xxxxxxxxxxxx")

# Сжатие
result = client.compress("photo.jpg", quality=80, format="webp")
print(result.url)

# Изменение размера
result = client.resize("photo.jpg", width=800)
print(result.url)

# Пакетная обработка
job = client.batch([
    {"file": "photo1.jpg", "quality": 80},
    {"file": "photo2.jpg", "quality": 80},
])
job.wait()  # ждёт завершения
print(job.results)
```

## SDK: Node.js

```javascript
const { PixelPush } = require('pixelpush-js')

const client = new PixelPush({ apiKey: 'pp_live_xxxxxxxxxxxx' })

// Сжатие
const result = await client.compress('photo.jpg', { quality: 80, format: 'webp' })
console.log(result.url)

// Изменение размера
const result = await client.resize('photo.jpg', { width: 800 })
console.log(result.url)
```

## Переменные окружения

Лучше не хранить ключ прямо в коде. SDK умеет читать ключ из перемнной окружения `PIXELPUSH_API_KEY`. Создайте файл `.env`:

```
PIXELPUSH_API_KEY=pp_live_xxxxxxxxxxxx
```

И не добавляйте `.env` в git! Если случайно закоммитили — немедленно идите в настройки и отзывайте ключ, он скомпрометирован.

## Часто задаваемые вопросы

Картинка не загружается. Проверьте что формат поддерживается: jpeg, png, gif, webp, avif, tiff, bmp. SVG не поддерживается. RAW форматы (CR2, NEF и т.д.) только на Enterprise.

Сколько запросов осталось? Смотрите заголовки `X-RateLimit-Remaining` и `X-RateLimit-Reset` в любом ответе.

Можно ли обрабатывать анимированные GIF? Да, анимация сохраняется при конвертации в WebP. При конвертации в JPEG/PNG берётся только первый кадр.

Как удалить загруженный файл? `DELETE https://api.pixelpush.io/v1/files/{id}` — только для файлов в постоянном хранилище.

Если есть вопросы или нашлись баги — пишите на support@pixelpush.io
