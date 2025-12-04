from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardMarkup, KeyboardButton

def main_menu() -> ReplyKeyboardMarkup:
    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎮 Играть"), KeyboardButton(text="💰 Баланс")],
            [KeyboardButton(text="⭐ Пополнить"), KeyboardButton(text="📊 Статистика")],
            [KeyboardButton(text="ℹ️ Правила")]
        ],
        resize_keyboard=True
    )
    return keyboard

def bet_amounts() -> InlineKeyboardMarkup:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⭐ 10", callback_data="bet_10"),
                InlineKeyboardButton(text="⭐ 25", callback_data="bet_25"),
                InlineKeyboardButton(text="⭐ 50", callback_data="bet_50")
            ],
            [
                InlineKeyboardButton(text="⭐ 100", callback_data="bet_100"),
                InlineKeyboardButton(text="⭐ 250", callback_data="bet_250"),
                InlineKeyboardButton(text="⭐ 500", callback_data="bet_500")
            ],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")]
        ]
    )
    return keyboard

def game_controls(can_cashout: bool = True) -> InlineKeyboardMarkup:
    buttons = []
    if can_cashout:
        buttons.append([InlineKeyboardButton(text="💰 Забрать выигрыш", callback_data="cashout")])
    buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="cancel_game")])
    
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def top_up_amounts() -> InlineKeyboardMarkup:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="⭐ 100", callback_data="topup_100"),
                InlineKeyboardButton(text="⭐ 250", callback_data="topup_250")
            ],
            [
                InlineKeyboardButton(text="⭐ 500", callback_data="topup_500"),
                InlineKeyboardButton(text="⭐ 1000", callback_data="topup_1000")
            ],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")]
        ]
    )
    return keyboard
