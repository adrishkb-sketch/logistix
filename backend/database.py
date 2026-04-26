import json
import os
import fcntl
from typing import List, Dict, Any, Optional

class JSONDatabase:
    def __init__(self, table_name: str):
        # Resolve absolute path to the logistix root directory's data folder
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.file_path = os.path.join(base_dir, "data", f"{table_name}.json")
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        if not os.path.exists(self.file_path):
            with open(self.file_path, "w") as f:
                json.dump([], f)

    def read(self) -> List[Dict[str, Any]]:
        with open(self.file_path, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = []
            fcntl.flock(f, fcntl.LOCK_UN)
            return data

    def write(self, data: List[Dict[str, Any]]):
        with open(self.file_path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            json.dump(data, f, indent=4)
            fcntl.flock(f, fcntl.LOCK_UN)

    def get_all(self) -> List[Dict[str, Any]]:
        return self.read()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        data = self.read()
        for item in data:
            if item.get("id") == item_id:
                return item
        return None

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        with open(self.file_path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = []
            data.append(item)
            f.seek(0)
            f.truncate()
            json.dump(data, f, indent=4)
            fcntl.flock(f, fcntl.LOCK_UN)
        return item

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        result = None
        with open(self.file_path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = []
            for i, item in enumerate(data):
                if item.get("id") == item_id:
                    data[i].update(updated_item)
                    result = data[i]
                    break
            if result:
                f.seek(0)
                f.truncate()
                json.dump(data, f, indent=4)
            fcntl.flock(f, fcntl.LOCK_UN)
        return result

    def delete(self, item_id: str) -> bool:
        deleted = False
        with open(self.file_path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = []
            initial_length = len(data)
            data = [item for item in data if item.get("id") != item_id]
            if len(data) < initial_length:
                deleted = True
                f.seek(0)
                f.truncate()
                json.dump(data, f, indent=4)
            fcntl.flock(f, fcntl.LOCK_UN)
        return deleted

    def clear_all(self):
        self.write([])

    @staticmethod
    def snapshot():
        """Creates a backup of all JSON files in the data directory."""
        import shutil
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(base_dir, "data")
        backup_dir = os.path.join(base_dir, "data_snapshot")
        
        if os.path.exists(backup_dir):
            shutil.rmtree(backup_dir)
        
        os.makedirs(backup_dir, exist_ok=True)
        for f in os.listdir(data_dir):
            if f.endswith(".json"):
                shutil.copy2(os.path.join(data_dir, f), os.path.join(backup_dir, f))

    @staticmethod
    def restore():
        """Restores all JSON files from the backup directory."""
        import shutil
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(base_dir, "data")
        backup_dir = os.path.join(base_dir, "data_snapshot")
        
        if not os.path.exists(backup_dir):
            return False
            
        for f in os.listdir(backup_dir):
            if f.endswith(".json"):
                shutil.copy2(os.path.join(backup_dir, f), os.path.join(data_dir, f))
        
        shutil.rmtree(backup_dir)
        return True
