import json
import os
from typing import List, Dict, Any, Optional
from threading import Lock

class JSONDatabase:
    def __init__(self, table_name: str):
        # Resolve absolute path to the logistix root directory's data folder
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.file_path = os.path.join(base_dir, "data", f"{table_name}.json")
        self.lock = Lock()
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        if not os.path.exists(self.file_path):
            with open(self.file_path, "w") as f:
                json.dump([], f)

    def read(self) -> List[Dict[str, Any]]:
        with self.lock:
            try:
                with open(self.file_path, "r") as f:
                    return json.load(f)
            except json.JSONDecodeError:
                return []

    def write(self, data: List[Dict[str, Any]]):
        with self.lock:
            with open(self.file_path, "w") as f:
                json.dump(data, f, indent=4)

    def get_all(self) -> List[Dict[str, Any]]:
        return self.read()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        data = self.read()
        for item in data:
            if item.get("id") == item_id:
                return item
        return None

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        data = self.read()
        data.append(item)
        self.write(data)
        return item

    def update(self, item_id: str, updated_item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        data = self.read()
        for i, item in enumerate(data):
            if item.get("id") == item_id:
                data[i].update(updated_item)
                self.write(data)
                return data[i]
        return None

    def delete(self, item_id: str) -> bool:
        data = self.read()
        initial_length = len(data)
        data = [item for item in data if item.get("id") != item_id]
        if len(data) < initial_length:
            self.write(data)
            return True
        return False

    def clear_all(self):
        self.write([])
