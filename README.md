# NERB Telegram Bot — Cloudflare Workers

## Что изменилось по сравнению с Flask/telebot-версией

- Python-библиотека `telebot` и Flask на Workers не работают (там нет обычного
  процесса на Python, только JS/TS-рантайм) — вся логика переписана на
  чистый JavaScript с прямыми HTTPS-запросами к `api.telegram.org`.
- Вместо `bot.set_webhook()` при старте приложения (Workers не имеют
  постоянно работающего процесса) добавлен отдельный эндпоинт `GET /setWebhook`,
  который нужно один раз открыть после деплоя.
- `CHAT_ID`, `BOT_TOKEN` задаются как секреты Cloudflare, а не переменные окружения ОС.

## Установка

1. Установите Wrangler (если ещё не установлен):
   ```
   npm install -g wrangler
   ```

2. Авторизуйтесь:
   ```
   wrangler login
   ```

3. В папке с `worker.js` и `wrangler.toml` задайте секреты:
   ```
   wrangler secret put BOT_TOKEN
   wrangler secret put CHAT_ID
   ```
   (по желанию, для доп. защиты вебхука)
   ```
   wrangler secret put WEBHOOK_SECRET
   ```

4. Задеплойте:
   ```
   wrangler deploy
   ```
   Wrangler выведет URL вида `https://nerb-telegram-bot.<ваш-поддомен>.workers.dev`.

5. Пропишите вебхук в Telegram — просто откройте в браузере:
   ```
   https://nerb-telegram-bot.<ваш-поддомен>.workers.dev/setWebhook
   ```
   В ответ должно прийти `{"ok": true, ...}`.

6. Проверьте, что бот отвечает: `GET /` должен вернуть `NERB Bot is running!`.

## Логика бота (сохранена без изменений по сути)

- `/start` — приветствие + инлайн-кнопки «Админы» / «Оформить описание».
- `/admnerb` — список администраторов чата.
- Фото в личке — бот отвечает «Зачем мне твоё фото?».
- Текст, начинающийся с `+Описание` (только в личных сообщениях) —
  проверка на наличие полей Имя/Ник/Айди/Возраст и выдача одноразовой
  инвайт-ссылки при успехе.
