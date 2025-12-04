from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardMarkup, InlineKeyboardButton
import asyncio

# ========== НАСТРОЙКИ ==========
BOT_TOKEN = "8565085670:AAHxMV0XFn0c5xuX-897ysJEnSqrVFgI4RY"
WEB_APP_URL = "https://web-production-3f4d.up.railway.app/webapp.html"
# ===============================

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

@dp.message(Command("start"))
async def start_command(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🚀 Играть в Rocket Crash",
            web_app=WebAppInfo(url=WEB_APP_URL)
        )]
    ])
    
    await message.answer(
        "🎮 <b>Добро пожаловать в Rocket Crash!</b>\n\n"
        "🚀 Нажмите кнопку ниже чтобы начать игру\n"
        "💰 Начальный баланс: 100 ⭐",
        reply_markup=keyboard,
        parse_mode="HTML"
    )

@dp.message(Command("help"))
async def help_command(message: types.Message):
    await message.answer(
        "📖 <b>Как играть:</b>\n\n"
        "1. Нажмите кнопку 'Играть'\n"
        "2. Введите ставку\n"
        "3. Нажмите 'Сделать ставку'\n"
        "4. Забирайте выигрыш до краша!\n\n"
        "💡 Чем выше множитель - тем больше выигрыш!",
        parse_mode="HTML"
    )

async def main():
    print("=" * 50)
    print("🤖 Бот Rocket Crash запущен!")
    print("=" * 50)
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⛔ Бот остановлен")
