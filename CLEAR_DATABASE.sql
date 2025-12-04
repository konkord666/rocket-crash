-- Команды для очистки базы данных PostgreSQL

-- 1. Удалить все данные из таблиц (сохраняя структуру)
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE game_history CASCADE;
TRUNCATE TABLE user_multipliers CASCADE;

-- 2. Или полностью удалить таблицы и пересоздать
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP TABLE IF EXISTS game_history CASCADE;
-- DROP TABLE IF EXISTS user_multipliers CASCADE;

-- После очистки сервер автоматически создаст таблицы заново при запуске

-- Для Railway выполните эти команды в разделе "Data" -> "Query"
