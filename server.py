import os
import json
import asyncio
from datetime import datetime
from aiohttp import web
import aiohttp_cors
from dotenv import load_dotenv

load_dotenv()

# Простая база данных в памяти (для продакшена используйте PostgreSQL/MongoDB)
users_db = {}
games_history = []
current_game = None

BOT_TOKEN = os.getenv('BOT_TOKEN')

async def get_user(request):
    """Получить данные пользователя"""
    data = await request.json()
    user_id = data.get('user_id')
    
    if user_id not in users_db:
        users_db[user_id] = {
            'user_id': user_id,
            'balance': 0,
            'total_games': 0,
            'total_wins': 0,
            'total_bets_amount': 0,
            'total_wins_amount': 0,
            'best_multiplier': 0,
            'multipliers': []
        }
    
    return web.json_response(users_db[user_id])

async def update_balance(request):
    """Обновить баланс пользователя"""
    data = await request.json()
    user_id = data.get('user_id')
    amount = data.get('amount', 0)
    
    if user_id in users_db:
        users_db[user_id]['balance'] += amount
        return web.json_response({'success': True, 'balance': users_db[user_id]['balance']})
    
    return web.json_response({'success': False, 'error': 'User not found'}, status=404)

async def place_bet(request):
    """Сделать ставку"""
    data = await request.json()
    user_id = data.get('user_id')
    bet_amount = data.get('bet_amount', 0)
    
    if user_id not in users_db:
        return web.json_response({'success': False, 'error': 'User not found'}, status=404)
    
    if users_db[user_id]['balance'] < bet_amount:
        return web.json_response({'success': False, 'error': 'Insufficient balance'}, status=400)
    
    users_db[user_id]['balance'] -= bet_amount
    
    return web.json_response({
        'success': True,
        'balance': users_db[user_id]['balance']
    })

async def record_game_result(request):
    """Записать результат игры"""
    data = await request.json()
    user_id = data.get('user_id')
    won = data.get('won', False)
    bet_amount = data.get('bet_amount', 0)
    win_amount = data.get('win_amount', 0)
    multiplier = data.get('multiplier', 0)
    
    if user_id not in users_db:
        return web.json_response({'success': False, 'error': 'User not found'}, status=404)
    
    user = users_db[user_id]
    user['total_games'] += 1
    user['total_bets_amount'] += bet_amount
    
    if won:
        user['total_wins'] += 1
        user['total_wins_amount'] += win_amount
        user['multipliers'].append(multiplier)
        user['balance'] += win_amount
        
        if multiplier > user['best_multiplier']:
            user['best_multiplier'] = multiplier
    
    return web.json_response({
        'success': True,
        'stats': {
            'total_games': user['total_games'],
            'total_wins': user['total_wins'],
            'balance': user['balance']
        }
    })

async def get_game_history(request):
    """Получить историю игр"""
    return web.json_response({'history': games_history[-6:]})

async def add_game_to_history(request):
    """Добавить игру в историю"""
    data = await request.json()
    crash_value = data.get('crash_value', 0)
    
    games_history.append(crash_value)
    if len(games_history) > 20:
        games_history.pop(0)
    
    return web.json_response({'success': True, 'history': games_history[-6:]})

async def get_online_users(request):
    """Получить количество онлайн пользователей"""
    # Симуляция онлайн пользователей
    online_count = len(users_db) + 10
    return web.json_response({'online': online_count})

async def health_check(request):
    """Health check для Amvera"""
    return web.json_response({'status': 'ok'})

async def init_app():
    app = web.Application()
    
    # CORS для работы с Telegram Mini App
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*"
        )
    })
    
    # Роуты
    app.router.add_post('/api/user/get', get_user)
    app.router.add_post('/api/user/update_balance', update_balance)
    app.router.add_post('/api/game/place_bet', place_bet)
    app.router.add_post('/api/game/record_result', record_game_result)
    app.router.add_get('/api/game/history', get_game_history)
    app.router.add_post('/api/game/add_history', add_game_to_history)
    app.router.add_get('/api/online', get_online_users)
    app.router.add_get('/health', health_check)
    
    # Статические файлы
    app.router.add_static('/', path='.')
    
    # Настройка CORS для всех роутов
    for route in list(app.router.routes()):
        cors.add(route)
    
    return app

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    app = asyncio.run(init_app())
    web.run_app(app, host='0.0.0.0', port=port)
