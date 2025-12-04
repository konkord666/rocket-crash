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
    // Фаза приема ставок (10 секунд)
    currentGameState.phase = 'betting';
    currentGameState.timer = 10;
    currentGameState.players = [];
    
    console.log('💰 Прием ставок начался');
    io.emit('betting_phase', { timer: 10 });
    
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
    
    // Отключение
    socket.on('disconnect', () => {
        console.log('👋 Игрок отключился:', socket.id);
        activePlayers.delete(socket.id);
        currentGameState.players = currentGameState.players.filter(p => p.id !== socket.id);
        io.emit('online_update', { online: activePlayers.size });
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 DATABASE_URL: ${process.env.DATABASE_URL ? 'Установлена' : 'НЕ УСТАНОВЛЕНА!'}`);
    console.log(`🔌 WebSocket готов для синхронизации игроков`);
    try {
        await initDatabase();
    } catch (error) {
        console.error('❌ Критическая ошибка при инициализации:', error);
    }
});
