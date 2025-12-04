from typing import Dict, Optional

class Database:
    def __init__(self):
        self.users: Dict[int, dict] = {}
        self.active_games: Dict[int, dict] = {}
    
    def get_user(self, user_id: int) -> dict:
        if user_id not in self.users:
            self.users[user_id] = {
                'balance': 0,
                'total_bets': 0,
                'total_wins': 0
            }
        return self.users[user_id]
    
    def update_balance(self, user_id: int, amount: int):
        user = self.get_user(user_id)
        user['balance'] += amount
    
    def place_bet(self, user_id: int, amount: int) -> bool:
        user = self.get_user(user_id)
        if user['balance'] >= amount:
            user['balance'] -= amount
            user['total_bets'] += 1
            return True
        return False
    
    def add_win(self, user_id: int, amount: int):
        user = self.get_user(user_id)
        user['balance'] += amount
        user['total_wins'] += 1
    
    def set_active_game(self, user_id: int, bet: int):
        self.active_games[user_id] = {
            'bet': bet,
            'multiplier': 1.0,
            'cashed_out': False
        }
    
    def get_active_game(self, user_id: int) -> Optional[dict]:
        return self.active_games.get(user_id)
    
    def remove_active_game(self, user_id: int):
        if user_id in self.active_games:
            del self.active_games[user_id]

db = Database()
