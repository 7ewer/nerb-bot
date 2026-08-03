import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
import os

bot = telebot.TeleBot(os.getenv("8601674142:AAH4-VnMRRGLBIvHzropjPc0JMR2hSRAMic"))
CHAT_ID = int(os.getenv("-1002576094434"))

@bot.message_handler(commands=['start'])
def start(message):
    markup = InlineKeyboardMarkup()

    btn1 = InlineKeyboardButton("👮 Админы", callback_data="admins")
    btn2 = InlineKeyboardButton(
        "📝 Перейти к оформлению описания!",
        callback_data="description"
    )

    markup.add(btn1)
    markup.add(btn2)

    bot.send_message(
        message.chat.id,
        "Доброго времени суток, вы написали боту Клана NERB!",
        reply_markup=markup
    )


@bot.callback_query_handler(func=lambda call: True)
def callback(call):

    if call.data == "description":
        bot.send_message(
            call.message.chat.id,
            "📄 Шаблон описания:\n\n"
            "+Описание\n"
            "Имя: Паша, Паштет\n"
            "Ник: dm Nemezz\n"
            "Айди: 52044684830\n"
            "Возраст: 17 лет\n"
            "Дата др: 11.07.2008 (не обязательно).\n\n"
            "📌 Шаблон ника:\n"
            "+Ник dm Nemezz (без лишних символов)."
        )

    elif call.data == "admins":

        admins = bot.get_chat_administrators(CHAT_ID)

        text = "👮 Администрация клана:\n\n"

        for admin in admins:
            if admin.user.is_bot:
                continue

            if admin.status in ["creator", "administrator"]:
                name = admin.user.first_name

                if admin.user.last_name:
                    name += " " + admin.user.last_name

                if admin.user.username:
                    name += f" (@{admin.user.username})"

                text += f"• {name}\n"

        bot.send_message(call.message.chat.id, text)

@bot.message_handler(commands=['admnerb'])
def admins_command(message):

    admins = bot.get_chat_administrators(CHAT_ID)

    text = "👮 Администрация клана NERB:\n\n"

    for admin in admins:
        # Не показываем ботов
        if admin.user.is_bot:
            continue

        # Только создатель и администраторы
        if admin.status in ["creator", "administrator"]:
            name = admin.user.first_name

            if admin.user.last_name:
                name += " " + admin.user.last_name

            if admin.user.username:
                name += f" (@{admin.user.username})"

            text += f"• {name}\n"

    bot.send_message(message.chat.id, text)


@bot.message_handler(content_types=['photo'])
def get_photo(message):
    bot.reply_to(message, "Зачем мне твоё фото?")


@bot.message_handler(content_types=['text'])
def check_description(message):

    if message.chat.type != "private":
        return

    text = message.text.strip()

    if not text.startswith("+Описание"):
        return

    name = "Имя:" in text
    nick = "Ник:" in text
    uid = "Айди:" in text
    age = "Возраст:" in text

    if name and nick and uid and age:

        invite = bot.create_chat_invite_link(
            chat_id=CHAT_ID,
            member_limit=1
        )

        bot.reply_to(
            message,
            "✅ Ваша заявка принята!\n\n"
            f"Ссылка для вступления:\n{invite.invite_link}"
        )

    else:
        bot.reply_to(
            message,
            "❌ Описание заполнено неправильно.\n\n"
            "Шаблон:\n\n"
            "+Описание\n"
            "Имя:\n"
            "Ник:\n"
            "Айди:\n"
            "Возраст:\n"
            "Дата др: (не обязательно)"
        )


bot.infinity_polling()