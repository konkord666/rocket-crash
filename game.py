import random
import asyncio
from typing import Tuple

class RocketGame:
    @staticmethod
    def generate_crash_point() -> float:
        """Генерирует точку краша (от 1.0 до 10.0)"""
        rand = random.random()
        if rand < 0.5:
            return round(1.0 + random.random() * 1.5, 2)
        elif rand < 0.8:
            return round(2.5 + random.random() * 2.5, 2)
        elif rand < 0.95:
            return round(5.0 + random.random() * 3.0, 2)
        else:
            return round(8.0 + random.random() * 2.0, 2)
    
    @staticmethod
    def get_rocket_animation(multiplier: float) -> str:
        """Создает визуализацию полета ракеты"""
        height = int(multiplier * 3)
        if height > 20:
            height = 20
        
        animation = []
        for i in range(height):
            spaces = " " * (20 - i)
            animation.append(f"{spaces}🚀")
        
        return "\n".join(animation) if animation else "🚀"
    
    @staticmethod
    async def simulate_flight(crash_point: float, callback) -> Tuple[float, bool]:
        """Симулирует полет ракеты"""
        multiplier = 1.0
        step = 0.1
        
        while multiplier < crash_point:
            await callback(multiplier, False)
            await asyncio.sleep(0.5)
            multiplier = round(multiplier + step, 2)
            
            if multiplier >= 2.0:
                step = 0.2
            if multiplier >= 5.0:
                step = 0.3
        
        await callback(crash_point, True)
        return crash_point, True
