// Cloudflare Worker — Telegram-бот клана NERB
// Секреты/переменные задаются через `wrangler secret put` или в дашборде Cloudflare:
//   BOT_TOKEN     — токен бота от @BotFather
//   CHAT_ID       — id группы/канала клана (число, можно отрицательное)
//   WEBHOOK_SECRET (опционально) — произвольная строка для доп. проверки запроса
// Durable Object биндинг:
//   MEDIA_GROUP_TRACKER — класс MediaGroupTracker (экспортирован ниже в этом же файле),
//   нужен чтобы не отвечать на каждое фото из альбома отдельно. Настраивается в wrangler.toml.

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

// ---------- Вспомогательные функции обращения к Telegram API ----------

async function tg(env, method, payload) {
  const res = await fetch(`${TELEGRAM_API(env.BOT_TOKEN)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function sendMessage(env, chatId, text, extra = {}) {
  return tg(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

function answerCallbackQuery(env, callbackQueryId, extra = {}) {
  return tg(env, "answerCallbackQuery", { callback_query_id: callbackQueryId, ...extra });
}

async function getChatAdministrators(env, chatId) {
  const data = await tg(env, "getChatAdministrators", { chat_id: chatId });
  return data.ok ? data.result : [];
}

async function createChatInviteLink(env, chatId, memberLimit = 1) {
  const data = await tg(env, "createChatInviteLink", {
    chat_id: chatId,
    member_limit: memberLimit,
  });
  return data.ok ? data.result : null;
}

// ---------- Формирование текста со списком админов ----------

function formatAdminsText(admins, title) {
  let text = `${title}\n\n`;

  for (const admin of admins) {
    if (admin.user.is_bot) continue;
    if (admin.status !== "creator" && admin.status !== "administrator") continue;

    let name = admin.user.first_name;
    if (admin.user.last_name) name += " " + admin.user.last_name;
    if (admin.user.username) name += ` (@${admin.user.username})`;

    text += `• ${name}\n`;
  }

  return text;
}

// ---------- Обработчики команд/сообщений ----------

async function handleStart(env, message) {
  const markup = {
    inline_keyboard: [
      [{ text: "👮 Админы", callback_data: "admins" }],
      [{ text: "📝 Перейти к оформлению описания!", callback_data: "description" }],
    ],
  };

  await sendMessage(
    env,
    message.chat.id,
    "Доброго времени суток, вы написали боту Клана NERB!",
    { reply_markup: markup }
  );
}

async function handleAdmNerbCommand(env, message) {
  const admins = await getChatAdministrators(env, env.CHAT_ID);
  const text = formatAdminsText(admins, "👮 Администрация клана NERB:");
  await sendMessage(env, message.chat.id, text);
}

// ---------- Durable Object: отсечение дублей альбомов фото ----------

// Обращается к Durable Object по имени = media_group_id. Так как каждый
// конкретный media_group_id всегда попадает в один и тот же экземпляр
// объекта, и Durable Object обрабатывает свои запросы строго по одному —
// только один вызов сможет "застолбить" группу первым.
async function claimMediaGroup(env, mediaGroupId) {
  const id = env.MEDIA_GROUP_TRACKER.idFromName(mediaGroupId);
  const stub = env.MEDIA_GROUP_TRACKER.get(id);
  const res = await stub.fetch("https://media-group-tracker/claim");
  const result = await res.text();
  return result === "first";
}

// Сам класс Durable Object. Экспортируется отдельно и подключается через
// биндинг MEDIA_GROUP_TRACKER в wrangler.toml (см. инструкцию).
export class MediaGroupTracker {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    const already = await this.state.storage.get("claimed");
    if (already) {
      return new Response("duplicate");
    }
    await this.state.storage.put("claimed", true);
    // Сам себя "забудет" через минуту, чтобы не копить данные вечно —
    // на такой короткий срок жизни объекта это не обязательно, но не мешает.
    await this.state.storage.setAlarm(Date.now() + 60_000);
    return new Response("first");
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

// ==== Варианты ответов на фото ====
// Меняй/добавляй строки прямо в этом списке, ничего больше трогать не нужно.
const PHOTO_REPLIES = [
  "Нах мне твоё фото?",
  "И? хоть комуто это чтото дало?",
  "Круто! Но не круче чем я)))",
  "Я бот клана. Торжественно произношу.....  САМ иди нахуй",
  "",
];

async function handlePhoto(env, message) {
  // Telegram присылает альбом (несколько фото одним сообщением) как ОТДЕЛЬНЫЕ
  // update'ы с одинаковым media_group_id, причём почти одновременно. Чтобы не
  // отвечать на каждое фото по отдельности, спрашиваем у Durable Object
  // MediaGroupTracker: "я первый по этой группе?". Durable Object обрабатывает
  // запросы строго по очереди (в отличие от KV, где из-за задержки
  // распространения записи "первым" могут посчитать себя сразу несколько
  // параллельных запросов) — поэтому дубли гарантированно отсекаются.
  if (message.media_group_id) {
    const isFirst = await claimMediaGroup(env, message.media_group_id);
    if (!isFirst) return;
  }

  const text = PHOTO_REPLIES[Math.floor(Math.random() * PHOTO_REPLIES.length)];

  await tg(env, "sendMessage", {
    chat_id: message.chat.id,
    text,
    reply_to_message_id: message.message_id,
  });
}

// ==== Триггерные ответы ====
// Список фраз, на которые бот отвечает заданным текстом.
// Формат: { triggers: ["фраза1", "фраза2", ...], reply: "текст ответа" }
// Совпадение ищется как ПОДСТРОКА, без учёта регистра (например, триггер
// "спасибо" сработает и на "Спасибо большое!").
// Добавляй/меняй элементы массива как угодно — больше ничего трогать не нужно.
const CUSTOM_TRIGGERS = [
  {
  triggers: ["Иди нахуй", "сходи нахуй"],
  reply: "Тебе помочь чем-то? Я просто бот меня не програмировали идти на то самое место! Но 7ewer за 320 юси добавит в в меня эту функцию!!!",
},
  {
  triggers: ["Гей?", "Молодой красень?"],
  reply: "Паша (Nemezz)",
},
  // {
  //   triggers: ["привет", "здравствуй"],
  //   reply: "Привет! Чем могу помочь?",
  // },
  // {
  //   triggers: ["правила"],
  //   reply: "Правила клана можно найти в закреплённом сообщении.",
  // },
];

function findCustomReply(text) {
  const lower = text.toLowerCase();
  for (const item of CUSTOM_TRIGGERS) {
    for (const trigger of item.triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        return item.reply;
      }
    }
  }
  return null;
}

// Проверяет, что сообщение реально адресовано боту:
// - в личных сообщениях — всегда
// - в группах — если это ответ (reply) на сообщение бота, либо в тексте
//   есть упоминание @username бота (задаётся через env.BOT_USERNAME)
function isAddressedToBot(env, message) {
  if (message.chat.type === "private") return true;

  const repliedToBot = !!(
    message.reply_to_message &&
    message.reply_to_message.from &&
    message.reply_to_message.from.is_bot
  );
  if (repliedToBot) return true;

  if (env.BOT_USERNAME) {
    const mention = `@${env.BOT_USERNAME}`.toLowerCase();
    if ((message.text || "").toLowerCase().includes(mention)) return true;
  }

  return false;
}

async function handleCustomTriggers(env, message) {
  if (!isAddressedToBot(env, message)) return false;

  const reply = findCustomReply(message.text || "");
  if (!reply) return false;

  await tg(env, "sendMessage", {
    chat_id: message.chat.id,
    text: reply,
    reply_to_message_id: message.message_id,
  });
  return true;
}

const DESCRIPTION_TEMPLATE =
  "📄 Это шаблон описания, его нужно санчало отправить в этот чат для проверки, если все правильно то после получения ссылки для встпления в группу отправь описание в основной чат:\n\n" +
  "+Описание\n" +
  "Имя: Паша, Паштет\n" +
  "Ник: dm Nemezz\n" +
  "Айди: 52044684830\n" +
  "Возраст: 17 лет\n" +
  "Дата др: 11.07.2008 (не обязательно).\n\n" +
  "📌 Шаблон ника:\n" +
  "+Ник dm Nemezz (без лишних символов).";

const DESCRIPTION_INVALID_TEXT =
  "❌ Описание заполнено неправильно.\n\n" +
  "Шаблон:\n\n" +
  "+Описание\n" +
  "Имя:\n" +
  "Ник:\n" +
  "Айди:\n" +
  "Возраст:\n" +
  "Дата др: (не обязательно)";

async function handleCallbackQuery(env, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;

  if (callbackQuery.data === "description") {
    await sendMessage(env, chatId, DESCRIPTION_TEMPLATE);
  } else if (callbackQuery.data === "admins") {
    const admins = await getChatAdministrators(env, env.CHAT_ID);
    const text = formatAdminsText(admins, "👮 Администрация клана:");
    await sendMessage(env, chatId, text);
  }

  // Обязательно подтверждаем callback, иначе кнопка "крутится" у пользователя
  await answerCallbackQuery(env, callbackQuery.id);
}

async function handleDescriptionText(env, message) {
  // Реагируем только в личных сообщениях
  if (message.chat.type !== "private") return;

  const text = (message.text || "").trim();
  if (!text.startsWith("+Описание")) return;

  const hasName = text.includes("Имя:");
  const hasNick = text.includes("Ник:");
  const hasUid = text.includes("Айди:");
  const hasAge = text.includes("Возраст:");

  if (hasName && hasNick && hasUid && hasAge) {
    const invite = await createChatInviteLink(env, env.CHAT_ID, 1);

    if (invite) {
      await tg(env, "sendMessage", {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text:
          "✅ Ваша заявка принята!\n\n" +
          `Ссылка для вступления:\n${invite.invite_link}`,
      });
    } else {
      await tg(env, "sendMessage", {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: "⚠️ Не удалось создать ссылку-приглашение. Обратитесь к администратору.",
      });
    }
  } else {
    await tg(env, "sendMessage", {
      chat_id: message.chat.id,
      reply_to_message_id: message.message_id,
      text: DESCRIPTION_INVALID_TEXT,
    });
  }
}

// ---------- Роутинг обновлений Telegram ----------

async function handleUpdate(env, update) {
  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message) return;

  if (message.photo) {
    await handlePhoto(env, message);
    return;
  }

  if (message.text) {
    const text = message.text.trim();

    if (text.startsWith("/start")) {
      await handleStart(env, message);
      return;
    }

    if (text.startsWith("/admnerb")) {
      await handleAdmNerbCommand(env, message);
      return;
    }

    const wasCustomReplyHandled = await handleCustomTriggers(env, message);
    if (wasCustomReplyHandled) return;

    await handleDescriptionText(env, message);
  }
}

// ---------- Точка входа Worker'а ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Telegram шлёт POST на путь /<BOT_TOKEN> — так же, как было в исходном Flask-приложении
    if (request.method === "POST" && url.pathname === `/${env.BOT_TOKEN}`) {
      // Необязательная доп. проверка секретным токеном Telegram
      // (см. secret_token в setWebhook) — если задан WEBHOOK_SECRET
      if (env.WEBHOOK_SECRET) {
        const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (header !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response("Bad Request", { status: 400 });
      }

      // Не блокируем ответ Telegram обработкой — но ждём, чтобы Worker не завершился раньше времени
      ctx.waitUntil(handleUpdate(env, update));

      return new Response("", { status: 200 });
    }

    // Служебный эндпоинт: один раз открыть в браузере, чтобы прописать вебхук в Telegram
    if (request.method === "GET" && url.pathname === "/setWebhook") {
      const webhookUrl = `${url.origin}/${env.BOT_TOKEN}`;
      const payload = { url: webhookUrl };
      if (env.WEBHOOK_SECRET) payload.secret_token = env.WEBHOOK_SECRET;

      const result = await tg(env, "setWebhook", payload);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("NERB Bot is running!", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};