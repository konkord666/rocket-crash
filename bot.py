import asyncio
import logging
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, LabeledPrice, PreCheckoutQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage

from config import BOT_TOKEN, PROVIDER_TOKEN
import os
from database import db
from game import RocketGame
from keyboards import main_menu, bet_amounts, game_controls, top_up_amounts

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bot = Bot(token=BOT_TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

class GameStates(StatesGroup):
    waiting_bet = State()
    in_game = State()

@dp.message(Command("start"))
async def cmd_start(message: Message):
    user = db.get_user(message.from_user.id)
    await message.answer(
        f"🚀 Добро пожаловать в Rocket Crash!\n\n"
        f"💰 Ваш баланс: {user['balance']} ⭐\n\n"
        f"Делайте ставки и забирайте выигрыш до того, как ракета взорвется!",
        reply_markup=main_menu()
    )

@dp.message(F.text == "🎮 Играть")
async def play_game(message: Message, state: FSMContext):
    user = db.get_user(message.from_user.id)
    
    if user['balance'] < 10:
        await message.answer(
            "❌ Недостаточно средств!\n"
            "Минимальная ставка: 10 ⭐\n\n"
            "Пополните баланс, чтобы начать играть.",
            reply_markup=main_menu()
        )
        return
    
    await message.answer(
        f"💰 Ваш баланс: {user['balance']} ⭐\n\n"
        "Выберите размер ставки:",
        reply_markup=bet_amounts()
    )
    await state.set_state(GameStates.waiting_bet)

@dp.callback_query(F.data.startswith("bet_"))
async def process_bet(callback: CallbackQuery, state: FSMContext):
    bet_amount = int(callback.data.split("_")[1])
    user_id = callback.from_user.id
    user = db.get_user(user_id)
    
    if not db.place_bet(user_id, bet_amount):
        await callback.answer("❌ Недостаточно средств!", show_alert=True)
        return
    
    await callback.answer()
    db.set_active_game(user_id, bet_amount)
    
    crash_point = RocketGame.generate_crash_point()
    await state.update_data(crash_point=crash_point, bet=bet_amount, message_id=callback.message.message_id)
    
    game_message = await callback.message.edit_text(
        f"🎮 Игра началась!\n"
        f"💰 Ставка: {bet_amount} ⭐\n"
        f"📈 Множитель: 1.00x\n\n"
        f"🚀\n\n"
        f"Нажмите 'Забрать выигрыш' в любой момент!",
        reply_markup=game_controls(True)
    )
    
    await state.set_state(GameStates.in_game)
    
    asyncio.create_task(run_game(user_id, crash_point, bet_amount, game_message.message_id, state))

async def run_game(user_id: int, crash_point: float, bet: int, message_id: int, state: FSMContext):
    multiplier = 1.0
    step = 0.1
    game = db.get_active_game(user_id)
    
    if not game:
        return
    
    try:
        while multiplier < crash_point:
            game = db.get_active_game(user_id)
            if not game or game.get('cashed_out'):
                return
            
            rocket_visual = RocketGame.get_rocket_animation(multiplier)
            potential_win = int(bet * multiplier)
            
            try:
                await bot.edit_message_text(
                    f"🎮 Игра идет!\n"
                    f"💰 Ставка: {bet} ⭐\n"
                    f"📈 Множитель: {multiplier:.2f}x\n"
                    f"💵 Потенциальный выигрыш: {potential_win} ⭐\n\n"
                    f"{rocket_visual}",
                    chat_id=user_id,
                    message_id=message_id,
                    reply_markup=game_controls(True)
                )
            except Exception as e:
                logger.error(f"Error updating message: {e}")
            
            await asyncio.sleep(0.8)
            multiplier = round(multiplier + step, 2)
            
            if multiplier >= 2.0:
                step = 0.15
            if multiplier >= 5.0:
                step = 0.25
        
        game = db.get_active_game(user_id)
        if game and not game.get('cashed_out'):
            await bot.edit_message_text(
                f"💥 КРАШ! Ракета взорвалась на {crash_point:.2f}x\n\n"
                f"❌ Вы проиграли {bet} ⭐\n"
                f"💰 Текущий баланс: {db.get_user(user_id)['balance']} ⭐",
                chat_id=user_id,
                message_id=message_id
            )
            db.remove_active_game(user_id)
            await state.clear()
    
    except Exception as e:
        logger.error(f"Game error: {e}")
        db.remove_active_game(user_id)
        await state.clear()

@dp.callback_query(F.data == "cashout", GameStates.in_game)
async def cashout(callback: CallbackQuery, state: FSMContext):
    user_id = callback.from_user.id
    game = db.get_active_game(user_id)
    
    if not game or game.get('cashed_out'):
        await callback.answer("❌ Игра уже завершена!", show_alert=True)
        return
    
    data = await state.get_data()
    bet = data.get('bet', 0)
    
    current_text = callback.message.text
    try:
        multiplier_line = [line for line in current_text.split('\n') if 'Множитель:' in line][0]
        multiplier = float(multiplier_line.split(':')[1].strip().replace('x', ''))
    except:
        multiplier = 1.0
    
    win_amount = int(bet * multiplier)
    db.add_win(user_id, win_amount)
    game['cashed_out'] = True
    
    await callback.message.edit_text(
        f"✅ Выигрыш забран!\n\n"
        f"📈 Множитель: {multiplier:.2f}x\n"
        f"💰 Выигрыш: {win_amount} ⭐\n"
        f"💵 Текущий баланс: {db.get_user(user_id)['balance']} ⭐"
    )
    
    db.remove_active_game(user_id)
    await state.clear()
    await callback.answer("🎉 Поздравляем с выигрышем!", show_alert=True)

@dp.message(F.text == "💰 Баланс")
async def show_balance(message: Message):
    user = db.get_user(message.from_user.id)
    await message.answer(
        f"💰 Ваш баланс: {user['balance']} ⭐",
        reply_markup=main_menu()
    )

@dp.message(F.text == "⭐ Пополнить")
async def top_up(message: Message):
    await message.answer(
        "💳 Выберите сумму пополнения:\n\n"
        "Оплата производится через Telegram Stars",
        reply_markup=top_up_amounts()
    )

@dp.callback_query(F.data.startswith("topup_"))
async def process_topup(callback: CallbackQuery):
    amount = int(callback.data.split("_")[1])
    
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title=f"Пополнение баланса на {amount} ⭐",
        description=f"Пополнение игрового баланса в Rocket Crash",
        payload=f"topup_{amount}",
        currency="XTR",
        prices=[LabeledPrice(label=f"{amount} Stars", amount=amount)]
    )
    
    await callback.answer()

@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.successful_payment)
async def process_successful_payment(message: Message):
    payload = message.successful_payment.invoice_payload
    amount = int(payload.split("_")[1])
    
    # Обновляем баланс на сервере
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{os.getenv('API_URL', 'http://localhost:8080')}/api/user/update_balance",
                json={'user_id': str(message.from_user.id), 'amount': amount}
            ) as resp:
                data = await resp.json()
                new_balance = data.get('balance', amount)
    except Exception as e:
        logger.error(f"Error updating balance on server: {e}")
        # Fallback к локальной базе
        db.update_balance(message.from_user.id, amount)
        new_balance = db.get_user(message.from_user.id)['balance']
    
    await message.answer(
        f"✅ Пополнение успешно!\n\n"
        f"💰 Зачислено: {amount} ⭐\n"
        f"💵 Текущий баланс: {new_balance} ⭐",
        reply_markup=main_menu()
    )

@dp.message(F.text == "📊 Статистика")
async def show_stats(message: Message):
    user = db.get_user(message.from_user.id)
    
    win_rate = 0
    if user['total_bets'] > 0:
        win_rate = (user['total_wins'] / user['total_bets']) * 100
    
    await message.answer(
        f"📊 Ваша статистика:\n\n"
        f"💰 Баланс: {user['balance']} ⭐\n"
        f"🎮 Всего игр: {user['total_bets']}\n"
        f"🏆 Выигрышей: {user['total_wins']}\n"
        f"📈 Процент побед: {win_rate:.1f}%",
        reply_markup=main_menu()
    )

@dp.message(F.text == "ℹ️ Правила")
async def show_rules(message: Message):
    await message.answer(
        "📖 Правила игры Rocket Crash:\n\n"
        "1️⃣ Сделайте ставку (минимум 10 ⭐)\n"
        "2️⃣ Ракета начнет взлетать, множитель растет\n"
        "3️⃣ Заберите выигрыш до того, как ракета взорвется!\n"
        "4️⃣ Чем дольше ждете - тем больше множитель\n"
        "5️⃣ Если ракета взорвется - ставка сгорает\n\n"
        "💡 Совет: Не жадничайте! Лучше забрать небольшой выигрыш, "
        "чем потерять всё.",
        reply_markup=main_menu()
    )

@dp.callback_query(F.data.in_(["cancel", "cancel_game"]))
async def cancel_action(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await callback.answer("Отменено")

async def main():
    logger.info("Starting bot...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
