# database.py (исправленная версия)

import sqlite3
import json
import logging
from typing import List, Dict, Optional
from collections import defaultdict

from config import DB_PATH, OWNER_ID

logger = logging.getLogger(__name__)

class Database:
    """Класс для управления базой данных SQLite."""
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        # ИЗМЕНЕНО: Вызываем инициализацию таблиц прямо в конструкторе.
        # Это гарантирует, что таблицы будут созданы при первом импорте.
        self.init_database()

    def _connect(self) -> sqlite3.Connection:
        """Устанавливает или возвращает существующее соединение с базой данных."""
        if self._conn is None:
            # check_same_thread=False нужен для работы SQLite с асинхронным кодом в рамках одного потока.
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def init_database(self):
        """Инициализирует таблицы в базе данных (если их нет)."""
        conn = self._connect()
        try:
            with conn:
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        user_id INTEGER PRIMARY KEY, 
                        chat_id INTEGER NOT NULL, 
                        username TEXT, 
                        first_name TEXT, 
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS user_times (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, 
                        user_id INTEGER, 
                        location TEXT NOT NULL, 
                        hour INTEGER NOT NULL, 
                        court_types TEXT NOT NULL, 
                        monitor_type_data TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
                        FOREIGN KEY (user_id) REFERENCES users (user_id), 
                        UNIQUE(user_id, location, hour, court_types, monitor_type_data)
                    )
                ''')
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS admins (
                        user_id INTEGER PRIMARY KEY, 
                        added_by INTEGER, 
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
            logger.info("База данных успешно инициализирована.")
        except Exception as e:
            logger.critical(f"Критическая ошибка при инициализации базы данных: {e}", exc_info=True)
            raise

    def add_user(self, user_id: int, chat_id: int, username: Optional[str] = None, first_name: Optional[str] = None):
        with self._connect() as conn:
            conn.execute('INSERT OR REPLACE INTO users (user_id, chat_id, username, first_name) VALUES (?, ?, ?, ?)', (user_id, chat_id, username, first_name))

    def add_user_time(self, user_id: int, location: str, hour: int, court_types: List[str], monitor_type_data: Dict):
        sorted_court_types_json = json.dumps(sorted(court_types))
        monitor_data_json = json.dumps(monitor_type_data, sort_keys=True)
        with self._connect() as conn:
            conn.execute('INSERT OR IGNORE INTO user_times (user_id, location, hour, court_types, monitor_type_data) VALUES (?, ?, ?, ?, ?)', (user_id, location, hour, sorted_court_types_json, monitor_data_json))

    def get_user_times(self, user_id: int) -> List[Dict]:
        with self._connect() as conn:
            rows = conn.execute('SELECT * FROM user_times WHERE user_id = ?', (user_id,)).fetchall()
            return [{**row, "court_types": json.loads(row["court_types"]), "monitor_data": json.loads(row["monitor_type_data"])} for row in rows]

    def get_all_monitored_data(self) -> Dict[int, Dict]:
        users_data = defaultdict(lambda: {"chat_id": None, "subscriptions": []})
        with self._connect() as conn:
            try:
                results = conn.execute('SELECT ut.user_id, u.chat_id, ut.location, ut.hour, ut.court_types, ut.monitor_type_data FROM user_times ut JOIN users u ON ut.user_id = u.user_id').fetchall()
                for row in results:
                    users_data[row['user_id']]["chat_id"] = row['chat_id']
                    users_data[row['user_id']]["subscriptions"].append({
                        "location": row['location'], "hour": row['hour'],
                        "court_types": json.loads(row['court_types']),
                        "monitor_data": json.loads(row['monitor_type_data'])
                    })
            except sqlite3.OperationalError as e:
                 logger.error(f"Ошибка при доступе к таблице user_times: {e}. Возможно, база данных еще не готова.")
                 return {} # Возвращаем пустой словарь, чтобы избежать падения
        return dict(users_data)

    def remove_user_time_by_id(self, subscription_id: int):
        with self._connect() as conn:
            conn.execute('DELETE FROM user_times WHERE id = ?', (subscription_id,))

    def remove_all_user_times(self, user_id: int):
        with self._connect() as conn:
            conn.execute('DELETE FROM user_times WHERE user_id = ?', (user_id,))

    def is_admin(self, user_id: int) -> bool:
        if user_id == OWNER_ID:
            return True
        with self._connect() as conn:
            return conn.cursor().execute("SELECT 1 FROM admins WHERE user_id = ?", (user_id,)).fetchone() is not None

    def add_admin(self, user_id: int, added_by_id: int):
        with self._connect() as conn:
            conn.execute("INSERT OR IGNORE INTO admins (user_id, added_by) VALUES (?, ?)", (user_id, added_by_id))

    def remove_admin(self, user_id: int):
        with self._connect() as conn:
            conn.execute("DELETE FROM admins WHERE user_id = ?", (user_id,))

    def get_all_admins(self) -> List[int]:
        with self._connect() as conn:
            return [row['user_id'] for row in conn.execute("SELECT user_id FROM admins")]

    def get_all_users_info(self) -> List[Dict]:
        with self._connect() as conn:
            return [dict(row) for row in conn.execute("SELECT user_id, chat_id, username, first_name FROM users ORDER BY created_at DESC")]

    def get_total_users_count(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def get_total_subscriptions_count(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM user_times").fetchone()[0]

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

# Создаем единственный экземпляр класса для всего приложения.
# При создании будет автоматически вызвана init_database().
db = Database()
