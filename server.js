const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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

// API: Онлайн пользователи
app.get('/api/online', (req, res) => {
    const online = Math.floor(Math.random() * 20) + 10;
    res.json({ online });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 DATABASE_URL: ${process.env.DATABASE_URL ? 'Установлена' : 'НЕ УСТАНОВЛЕНА!'}`);
    try {
        await initDatabase();
    } catch (error) {
        console.error('❌ Критическая ошибка при инициализации:', error);
    }
});
