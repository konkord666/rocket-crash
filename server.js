const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Активные игроки
let activePlayers = new Set();
let currentGameState = {
    isActive: false,
    multiplier: 1.0,
    crashPoint: 0,
    players: []
};

// Подключение к PostgreSQL (Railway автоматически предоставит DATABASE_URL)
if (!process.env.DATABASE_URL) {
    console.error('❌ ОШИБКА: DATABASE_URL не установлена!');
    console.error('Добавьте переменную DATABASE_URL в Settings → Variables');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Инициализация базы данных
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                balance INTEGER DEFAULT 100,
                total_games INTEGER DEFAULT 0,
                total_wins INTEGER DEFAULT 0,
                total_bets_amount INTEGER DEFAULT 0,
                total_wins_amount INTEGER DEFAULT 0,
                best_multiplier REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_history (
                id SERIAL PRIMARY KEY,
                crash_value REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_multipliers (
                id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id),
                multiplier REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ База данных инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Логирование
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// API: Получить данные пользователя
app.post('/api/user/get', async (req, res) => {
    try {
        const userId = req.body.user_id || 'demo';
        
        let user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        
        if (user.rows.length === 0) {
            await pool.query('INSERT INTO users (user_id, balance) VALUES ($1, $2)', [userId, 100]);
            
            return res.json({
                balance: 100,
                total_games: 0,
                total_wins: 0,
                total_bets_amount: 0,
                total_wins_amount: 0,
                best_multiplier: 0,
                multipliers: []
            });
        }
        
        const multipliers = await pool.query(
            'SELECT multiplier FROM user_multipliers WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
            [userId]
        );
        
        res.json({
            balance: user.rows[0].balance,
            total_games: user.rows[0].total_games,
            total_wins: user.rows[0].total_wins,
            total_bets_amount: user.rows[0].total_bets_amount,
            total_wins_amount: user.rows[0].total_wins_amount,
            best_multiplier: user.rows[0].best_multiplier,
            multipliers: multipliers.rows.map(m => m.multiplier)
        });
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Обновить баланс
app.post('/api/user/update_balance', async (req, res) => {
    try {
        const userId = req.body.user_id || 'demo';
        const amount = parseInt(req.body.amount);
        
        await pool.query(
            'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
            [amount, userId]
        );
        
        const user = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        
        res.json({ success: true, balance: user.rows[0].balance });
    } catch (error) {
        console.error('Error updating balance:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Сделать ставку
app.post('/api/game/place_bet', async (req, res) => {
    try {
        const userId = req.body.user_id || 'demo';
        const betAmount = parseInt(req.body.bet_amount);
        
        const user = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        
        if (user.rows.length === 0 || user.rows[0].balance < betAmount) {
            return res.json({ success: false, error: 'Недостаточно средств' });
        }
        
        await pool.query(
            'UPDATE users SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
            [betAmount, userId]
        );
        
        const updatedUser = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        
        res.json({ success: true, balance: updatedUser.rows[0].balance });
    } catch (error) {
        console.error('Error placing bet:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Записать результат игры
app.post('/api/game/record_result', async (req, res) => {
    try {
        const userId = req.body.user_id || 'demo';
        const won = req.body.won;
        const betAmount = parseInt(req.body.bet_amount);
        const winAmount = parseInt(req.body.win_amount);
        const multiplier = parseFloat(req.body.multiplier);
        
        let query = `
            UPDATE users SET 
            total_games = total_games + 1,
            total_bets_amount = total_bets_amount + $1,
            updated_at = CURRENT_TIMESTAMP
        `;
        let params = [betAmount];
        
        if (won) {
            query += `, total_wins = total_wins + 1, total_wins_amount = total_wins_amount + $2`;
            params.push(winAmount);
            
            const user = await pool.query('SELECT best_multiplier FROM users WHERE user_id = $1', [userId]);
            if (user.rows[0] && multiplier > user.rows[0].best_multiplier) {
                await pool.query('UPDATE users SET best_multiplier = $1 WHERE user_id = $2', [multiplier, userId]);
            }
            
            await pool.query('INSERT INTO user_multipliers (user_id, multiplier) VALUES ($1, $2)', [userId, multiplier]);
        }
        
        query += ' WHERE user_id = $' + (params.length + 1);
        params.push(userId);
        
        await pool.query(query, params);
        
        const stats = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        
        res.json({ success: true, stats: stats.rows[0] });
    } catch (error) {
        console.error('Error recording result:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Получить историю игр
app.get('/api/game/history', async (req, res) => {
    try {
        const history = await pool.query(
            'SELECT crash_value FROM game_history ORDER BY created_at DESC LIMIT 50'
        );
        
        res.json({ history: history.rows.map(h => h.crash_value) });
    } catch (error) {
        console.error('Error getting history:', error);
        res.json({ history: [] });
    }
});

// API: Добавить в историю
app.post('/api/game/add_history', async (req, res) => {
    try {
        const crashValue = parseFloat(req.body.crash_value);
        
        await pool.query('INSERT INTO game_history (crash_value) VALUES ($1)', [crashValue]);
        
        const history = await pool.query(
            'SELECT crash_value FROM game_history ORDER BY created_at DESC LIMIT 50'
        );
        
        res.json({ success: true, history: history.rows.map(h => h.crash_value) });
    } catch (error) {
        console.error('Error adding history:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Онлайн пользователи (реальное количество)
app.get('/api/online', (req, res) => {
    res.json({ online: activePlayers.size });
});

// Серверная игра - запускается автоматически каждые 15 секунд
let gameInterval = null;
let bettingTimer = null;

function generateCrashPoint() {
    const rand = Math.random();
    if (rand < 0.60) return 1.0 + Math.random() * 1.0;
    else if (rand < 0.85) return 2.0 + Math.random() * 2.0;
    else if (rand < 0.95) return 4.0 + Math.random() * 3.0;
    else if (rand < 0.99) return 7.0 + Math.random() * 8.0;
    else return 15.0 + Math.random() * 35.0;
}

function startServerGame() {
    // Фаза приема ставок (20 секунд, последние 5 - обратный отсчет)
    currentGameState.phase = 'betting';
    currentGameState.timer = 20;
    currentGameState.players = [];
    
    console.log('💰 Прием ставок начался (20 секунд)');
    io.emit('betting_phase', { timer: 20 });
    
    bettingTimer = setInterval(() => {
        currentGameState.timer--;
        io.emit('timer_update', { timer: currentGameState.timer });
        
        if (currentGameState.timer <= 0) {
            clearInterval(bettingTimer);
            startFlying();
        }
    }, 1000);
}

function startFlying() {
    // Фаза полета
    currentGameState.phase = 'flying';
    currentGameState.isActive = true;
    currentGameState.multiplier = 1.0;
    currentGameState.crashPoint = generateCrashPoint();
    currentGameState.startTime = Date.now();
    
    console.log(`🚀 Ракета полетела! Краш на ${currentGameState.crashPoint.toFixed(2)}x`);
    io.emit('game_started', { crashPoint: currentGameState.crashPoint });
    
    // Обновление множителя каждые 50мс
    gameInterval = setInterval(() => {
        const elapsed = (Date.now() - currentGameState.startTime) / 1000;
        currentGameState.multiplier = Math.pow(1.06, elapsed * 2);
        
        if (currentGameState.multiplier >= currentGameState.crashPoint) {
            crashGame();
        } else {
            io.emit('multiplier_update', { multiplier: currentGameState.multiplier });
        }
    }, 50);
}

function crashGame() {
    clearInterval(gameInterval);
    currentGameState.isActive = false;
    currentGameState.phase = 'crashed';
    
    console.log(`💥 Краш на ${currentGameState.crashPoint.toFixed(2)}x`);
    
    // Обновляем проигравших
    currentGameState.players.forEach(player => {
        if (!player.cashedOut) {
            player.result = 'lose';
        }
    });
    
    io.emit('game_crashed', {
        crashPoint: currentGameState.crashPoint,
        players: currentGameState.players
    });
    
    // Сохраняем в историю
    pool.query('INSERT INTO game_history (crash_value) VALUES ($1)', [currentGameState.crashPoint])
        .catch(err => console.error('Error saving history:', err));
    
    // Новая игра через 5 секунд
    setTimeout(() => {
        startServerGame();
    }, 5000);
}

// Запуск первой игры при старте сервера
setTimeout(() => {
    console.log('🎮 Запуск игрового цикла');
    startServerGame();
}, 2000);

// WebSocket для игроков
io.on('connection', (socket) => {
    console.log('👤 Игрок подключился:', socket.id);
    activePlayers.add(socket.id);
    
    // Отправляем текущее состояние
    socket.emit('game_state', {
        phase: currentGameState.phase,
        multiplier: currentGameState.multiplier,
        timer: currentGameState.timer,
        players: currentGameState.players,
        online: activePlayers.size
    });
    
    io.emit('online_update', { online: activePlayers.size });
    
    // Игрок сделал ставку
    socket.on('place_bet', async (data) => {
        if (currentGameState.phase !== 'betting') {
            socket.emit('bet_error', { message: 'Прием ставок закрыт' });
            return;
        }
        
        const player = {
            id: socket.id,
            userId: data.userId,
            name: data.name || 'Игрок',
            bet: data.bet,
            cashedOut: false,
            cashoutMultiplier: null,
            result: null
        };
        
        currentGameState.players.push(player);
        
        // Отправляем всем
        io.emit('player_bet', player);
        console.log(`💰 ${player.name} поставил ${player.bet} ⭐`);
    });
    
    // Игрок забрал выигрыш
    socket.on('cashout', (data) => {
        const player = currentGameState.players.find(p => p.id === socket.id);
        if (player && !player.cashedOut && currentGameState.isActive) {
            player.cashedOut = true;
            player.cashoutMultiplier = currentGameState.multiplier;
            player.result = 'win';
            
            const winAmount = Math.floor(player.bet * player.cashoutMultiplier);
            
            io.emit('player_cashout', {
                id: socket.id,
                name: player.name,
                multiplier: player.cashoutMultiplier,
                winAmount: winAmount
            });
            
            console.log(`✅ ${player.name} забрал ${winAmount} ⭐ на ${player.cashoutMultiplier.toFixed(2)}x`);
        }
    });
    
    // Ставка на рулетку
    socket.on('roulette_bet', async (data) => {
        if (rouletteGameState.phase !== 'betting') {
            socket.emit('roulette_error', { message: 'Ставки закрыты!' });
            return;
        }
        
        const { userId, amount, type, name } = data;
        
        // Проверяем баланс
        try {
            const result = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
            if (result.rows.length === 0 || result.rows[0].balance < amount) {
                socket.emit('roulette_error', { message: 'Недостаточно средств!' });
                return;
            }
            
            // Списываем ставку
            await pool.query('UPDATE users SET balance = balance - $1 WHERE user_id = $2', [amount, userId]);
            
            // Добавляем ставку
            const bet = {
                userId,
                socketId: socket.id,
                name,
                amount,
                type
            };
            
            rouletteGameState.bets.push(bet);
            
            // Отправляем всем игрокам информацию о ставке
            io.emit('roulette_bet_placed', {
                name,
                amount,
                type
            });
            
            console.log(`🎰 ${name} поставил ${amount} ⭐ на ${type}`);
            
            socket.emit('roulette_bet_success', { balance: result.rows[0].balance - amount });
        } catch (error) {
            console.error('Ошибка ставки на рулетку:', error);
            socket.emit('roulette_error', { message: 'Ошибка сервера' });
        }
    });
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('👋 Игрок отключился:', socket.id);
        activePlayers.delete(socket.id);
        currentGameState.players = currentGameState.players.filter(p => p.id !== socket.id);
        io.emit('online_update', { online: activePlayers.size });
    });
});

// ============ РУЛЕТКА ============
const rouletteNumbers = [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, '00', 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2];
const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const blackNumbers = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

let rouletteGameState = {
    phase: 'betting', // betting, countdown, spinning, result
    timer: 25,
    resultNumber: null,
    bets: []
};

function getNumberColor(num) {
    if (num === 0 || num === '00') return 'green';
    if (redNumbers.includes(num)) return 'red';
    return 'black';
}

function generateRouletteResult() {
    return rouletteNumbers[Math.floor(Math.random() * rouletteNumbers.length)];
}

function startRouletteGame() {
    // Фаза 1: Прием ставок (25 секунд)
    rouletteGameState.phase = 'betting';
    rouletteGameState.timer = 25;
    rouletteGameState.bets = [];
    rouletteGameState.resultNumber = null;
    
    io.emit('roulette_state', rouletteGameState);
    
    const bettingInterval = setInterval(() => {
        rouletteGameState.timer--;
        
        if (rouletteGameState.timer === 5) {
            // За 5 секунд до конца - обратный отсчет
            rouletteGameState.phase = 'countdown';
            io.emit('roulette_state', rouletteGameState);
        }
        
        if (rouletteGameState.timer > 0) {
            io.emit('roulette_timer', { timer: rouletteGameState.timer });
        } else {
            clearInterval(bettingInterval);
            spinRoulette();
        }
    }, 1000);
}

function spinRoulette() {
    // Фаза 2: Вращение (4 секунды)
    rouletteGameState.phase = 'spinning';
    rouletteGameState.resultNumber = generateRouletteResult();
    
    io.emit('roulette_spin', { resultNumber: rouletteGameState.resultNumber });
    
    console.log(`🎰 Рулетка крутится... Результат: ${rouletteGameState.resultNumber}`);
    
    setTimeout(() => {
        showRouletteResult();
    }, 4000);
}

async function showRouletteResult() {
    // Фаза 3: Результат (3 секунды)
    rouletteGameState.phase = 'result';
    
    const resultColor = getNumberColor(rouletteGameState.resultNumber);
    
    console.log(`✅ Выпало: ${rouletteGameState.resultNumber} (${resultColor})`);
    
    // Обрабатываем ставки
    for (const bet of rouletteGameState.bets) {
        const won = (bet.type === 'red' && resultColor === 'red') || 
                    (bet.type === 'black' && resultColor === 'black') || 
                    (bet.type == rouletteGameState.resultNumber); // == для сравнения 0 и '00'
        
        if (won) {
            let winAmount = 0;
            if (bet.type === 'red' || bet.type === 'black') {
                winAmount = bet.amount * 2;
            } else {
                // Ставка на конкретное число (включая 0 и 00)
                winAmount = bet.amount * 36;
            }
            
            try {
                await pool.query(
                    'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
                    [winAmount, bet.userId]
                );
                
                console.log(`💰 ${bet.name} выиграл ${winAmount} ⭐`);
                
                io.to(bet.socketId).emit('roulette_win', {
                    amount: winAmount,
                    number: rouletteGameState.resultNumber
                });
            } catch (error) {
                console.error('Ошибка начисления выигрыша:', error);
            }
        }
    }
    
    io.emit('roulette_result', {
        number: rouletteGameState.resultNumber,
        color: resultColor
    });
    
    // Через 3 секунды начинаем новую игру
    setTimeout(() => {
        startRouletteGame();
    }, 3000);
}

// API: Получить бонус (раз в час)
app.post('/api/user/claim_bonus', async (req, res) => {
    try {
        const userId = req.body.user_id || 'demo';
        
        const user = await pool.query('SELECT last_bonus_claim FROM users WHERE user_id = $1', [userId]);
        
        if (user.rows.length === 0) {
            return res.json({ success: false, error: 'Пользователь не найден' });
        }
        
        const lastClaim = user.rows[0].last_bonus_claim;
        const now = new Date();
        
        if (lastClaim) {
            const hoursSince = (now - new Date(lastClaim)) / (1000 * 60 * 60);
            if (hoursSince < 1) {
                const minutesLeft = Math.ceil((1 - hoursSince) * 60);
                return res.json({ success: false, error: 'Бонус доступен через ' + minutesLeft + ' мин', minutesLeft });
            }
        }
        
        await pool.query(
            'UPDATE users SET balance = balance + 5000, last_bonus_claim = CURRENT_TIMESTAMP WHERE user_id = $1',
            [userId]
        );
        
        const updated = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        
        res.json({ success: true, balance: updated.rows[0].balance, bonus: 5000 });
    } catch (error) {
        console.error('Error claiming bonus:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Админ - выдать валюту
app.post('/api/admin/give_currency', async (req, res) => {
    try {
        const adminId = req.body.admin_id;
        const targetUserId = req.body.target_user_id;
        const amount = parseInt(req.body.amount);
        
        if (adminId !== '840879061') {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        await pool.query('UPDATE users SET balance = balance + $1 WHERE user_id = $2', [amount, targetUserId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error giving currency:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Админ - получить список игроков
app.post('/api/admin/get_users', async (req, res) => {
    try {
        const adminId = req.body.admin_id;
        
        if (adminId !== '840879061') {
            return res.json({ success: false, error: 'Нет прав' });
        }
        
        const users = await pool.query('SELECT user_id, balance, total_games FROM users ORDER BY balance DESC LIMIT 100');
        
        res.json({ success: true, users: users.rows });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Получить топ игроков
app.post('/api/leaderboard', async (req, res) => {
    try {
        const type = req.body.type || 'balance';
        let query;
        
        if (type === 'balance') {
            query = 'SELECT user_id, balance, total_games, total_wins FROM users ORDER BY balance DESC LIMIT 50';
        } else if (type === 'wins') {
            query = 'SELECT user_id, balance, total_games, total_wins FROM users ORDER BY total_wins DESC LIMIT 50';
        } else {
            query = 'SELECT user_id, balance, total_games, total_wins FROM users ORDER BY total_games DESC LIMIT 50';
        }
        
        const result = await pool.query(query);
        
        res.json({ success: true, leaderboard: result.rows });
    } catch (error) {
        console.error('Error getting leaderboard:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 DATABASE_URL: ${process.env.DATABASE_URL ? 'Установлена' : 'НЕ УСТАНОВЛЕНА!'}`);
    console.log(`🔌 WebSocket готов для синхронизации игроков`);
    try {
        await initDatabase();
        
        // Добавляем колонку last_bonus_claim если её нет
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_bonus_claim TIMESTAMP
        `);
        
        // Запускаем рулетку
        startRouletteGame();
        console.log('🎰 Рулетка запущена!');
    } catch (error) {
        console.error('❌ Критическая ошибка при инициализации:', error);
    }
});
