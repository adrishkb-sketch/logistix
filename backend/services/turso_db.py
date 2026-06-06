"""
Turso (libSQL) HTTP client for persistent storage.

Uses Turso REST pipeline API - stdlib urllib only, no extra packages.
Falls back gracefully to the local JSON file when TURSO_DATABASE_URL is not set.

Environment variables required on Vercel:
  TURSO_DATABASE_URL   e.g. libsql://logistix-yourname.turso.io
  TURSO_AUTH_TOKEN     the auth token generated from Turso dashboard
"""
import os
import json
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

# Config
_RAW_URL = os.environ.get("TURSO_DATABASE_URL", "")
_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
_HTTP_URL = _RAW_URL.replace("libsql://", "https://") if _RAW_URL else ""

_DEFAULT_COMPANY = {
    "id": "557f9b08-30da-4b99-b233-a16c9df5191d",
    "name": "Logistix India Corp",
    "email": "manager@logistix.com",
    "password": "password123",
}


def _is_configured() -> bool:
    return bool(_HTTP_URL and _TOKEN)


def _execute(statements: List[Dict]) -> List[Any]:
    """Execute SQL statements via Turso HTTP pipeline."""
    if not _is_configured():
        raise RuntimeError("Turso not configured")

    reqs = []
    for stmt in statements:
        reqs.append({
            "type": "execute",
            "stmt": {
                "sql": stmt["sql"],
                "named_args": [
                    {"name": k, "value": {"type": "text", "value": str(v)}}
                    for k, v in stmt.get("args", {}).items()
                ]
            }
        })
    reqs.append({"type": "close"})

    payload = json.dumps({"requests": reqs}).encode("utf-8")
    http_req = urllib.request.Request(
        f"{_HTTP_URL}/v2/pipeline",
        data=payload,
        headers={
            "Authorization": f"Bearer {_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(http_req, timeout=10) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Turso HTTP {e.code}: {err_body}")

    results = []
    for r in body.get("results", []):
        if r.get("type") == "error":
            raise RuntimeError(f"Turso SQL error: {r.get('error', {}).get('message')}")
        if r.get("type") == "ok":
            results.append(r.get("response", {}).get("result", {}))
    return results


def _row_to_dict(cols: List[str], row: List[Any]) -> Dict[str, Any]:
    return {
        col: (cell["value"] if isinstance(cell, dict) else cell)
        for col, cell in zip(cols, row)
    }


def _result_to_dicts(result: Dict) -> List[Dict[str, Any]]:
    cols = [c["name"] for c in result.get("cols", [])]
    return [_row_to_dict(cols, row) for row in result.get("rows", [])]


# --- Companies table bootstrap ---
_TABLE_CREATED = False


def _ensure_companies_table():
    global _TABLE_CREATED
    if _TABLE_CREATED:
        return
    _execute([{
        "sql": (
            "CREATE TABLE IF NOT EXISTS companies ("
            "  id TEXT PRIMARY KEY,"
            "  name TEXT NOT NULL,"
            "  email TEXT NOT NULL UNIQUE,"
            "  password TEXT NOT NULL"
            ")"
        )
    }])
    try:
        _execute([{
            "sql": "INSERT OR IGNORE INTO companies (id, name, email, password) "
                   "VALUES (:id, :name, :email, :password)",
            "args": _DEFAULT_COMPANY
        }])
    except Exception:
        pass
    _TABLE_CREATED = True


# --- Generic blob table bootstrap ---
_GENERIC_TABLES_CREATED: set = set()


def _ensure_generic_table(table_name: str):
    if table_name in _GENERIC_TABLES_CREATED:
        return
    _execute([{
        "sql": (
            f"CREATE TABLE IF NOT EXISTS {table_name} ("
            "  id TEXT PRIMARY KEY,"
            "  data TEXT NOT NULL"
            ")"
        )
    }])
    _GENERIC_TABLES_CREATED.add(table_name)


# ============================================================
# TursoCompaniesDB - structured companies table
# ============================================================
class TursoCompaniesDB:
    """Persistent companies store backed by Turso. Falls back to local JSON."""

    def __init__(self):
        if _is_configured():
            _ensure_companies_table()
        else:
            print("[TursoDB] Turso not configured - using local JSON")

    def _fallback(self):
        from backend.database import JSONDatabase
        return JSONDatabase("companies")

    def get_all(self) -> List[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().get_all()
        try:
            results = _execute([{"sql": "SELECT id, name, email, password FROM companies"}])
            return _result_to_dicts(results[0]) if results else []
        except Exception as e:
            print(f"[TursoDB] get_all error: {e}")
            return self._fallback().get_all()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().get_by_id(item_id)
        try:
            results = _execute([{
                "sql": "SELECT id, name, email, password FROM companies WHERE id = :id LIMIT 1",
                "args": {"id": item_id}
            }])
            rows = _result_to_dicts(results[0]) if results else []
            return rows[0] if rows else None
        except Exception as e:
            print(f"[TursoDB] get_by_id error: {e}")
            return self._fallback().get_by_id(item_id)

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        all_items = self.get_all()
        return [i for i in all_items if all(str(i.get(k)) == str(v) for k, v in filters.items())]

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        if not _is_configured():
            return self._fallback().insert(item)
        try:
            _execute([{
                "sql": "INSERT OR REPLACE INTO companies (id, name, email, password) "
                       "VALUES (:id, :name, :email, :password)",
                "args": {
                    "id": item.get("id", ""),
                    "name": item.get("name", ""),
                    "email": item.get("email", ""),
                    "password": item.get("password", ""),
                }
            }])
            return item
        except Exception as e:
            print(f"[TursoDB] insert error: {e}")
            return self._fallback().insert(item)

    def update(self, item_id: str, updated: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().update(item_id, updated)
        try:
            current = self.get_by_id(item_id)
            if not current:
                return None
            current.update(updated)
            return self.insert(current)
        except Exception as e:
            print(f"[TursoDB] update error: {e}")
            return self._fallback().update(item_id, updated)

    def delete(self, item_id: str) -> bool:
        if not _is_configured():
            return self._fallback().delete(item_id)
        try:
            _execute([{"sql": "DELETE FROM companies WHERE id = :id", "args": {"id": item_id}}])
            return True
        except Exception as e:
            print(f"[TursoDB] delete error: {e}")
            return self._fallback().delete(item_id)


# ============================================================
# TursoGenericDB - JSON blob store for ANY table
# ============================================================
class TursoGenericDB:
    """
    Drop-in replacement for JSONDatabase backed by Turso on Vercel.

    Stores each record as a JSON blob: (id TEXT, data TEXT).
    This means the schema is completely flexible - works for warehouses,
    drivers, vehicles, shipments, or any other table.

    On Vercel (TURSO_DATABASE_URL set): writes persist across all invocations.
    Locally (no env vars): falls back transparently to local JSON files.

    Auto-seeds from bundled local JSON files on first cold start.
    """

    def __init__(self, table_name: str):
        self.table_name = table_name
        if _is_configured():
            try:
                _ensure_generic_table(table_name)
                self._seed_if_empty()
            except Exception as e:
                print(f"[TursoGenericDB:{table_name}] init error: {e}")
        else:
            print(f"[TursoGenericDB:{table_name}] Turso not configured - using local JSON")

    def _fallback(self):
        from backend.database import JSONDatabase
        return JSONDatabase(self.table_name)

    def _seed_if_empty(self):
        """One-time seed from bundled local JSON when Turso table is brand new."""
        try:
            results = _execute([{"sql": f"SELECT COUNT(*) as cnt FROM {self.table_name}"}])
            if results:
                rows = results[0].get("rows", [])
                if rows:
                    count_val = rows[0][0]
                    count = int(count_val["value"] if isinstance(count_val, dict) else count_val)
                    if count > 0:
                        return  # Already has data
            # Empty - seed from local JSON
            from backend.database import JSONDatabase
            local_items = JSONDatabase(self.table_name).get_all()
            if local_items:
                print(f"[TursoGenericDB:{self.table_name}] Seeding {len(local_items)} records...")
                for item in local_items:
                    try:
                        _execute([{
                            "sql": f"INSERT OR IGNORE INTO {self.table_name} (id, data) VALUES (:id, :data)",
                            "args": {
                                "id": str(item.get("id", "")),
                                "data": json.dumps(item, ensure_ascii=False)
                            }
                        }])
                    except Exception as se:
                        print(f"[TursoGenericDB:{self.table_name}] seed row error: {se}")
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] seed_if_empty error: {e}")

    def get_all(self) -> List[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().get_all()
        try:
            results = _execute([{"sql": f"SELECT data FROM {self.table_name}"}])
            rows = _result_to_dicts(results[0]) if results else []
            items = []
            for row in rows:
                try:
                    items.append(json.loads(row.get("data", "{}")))
                except Exception:
                    pass
            return items
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] get_all error: {e}")
            return self._fallback().get_all()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().get_by_id(item_id)
        try:
            results = _execute([{
                "sql": f"SELECT data FROM {self.table_name} WHERE id = :id LIMIT 1",
                "args": {"id": str(item_id)}
            }])
            rows = _result_to_dicts(results[0]) if results else []
            if rows:
                return json.loads(rows[0].get("data", "{}"))
            return None
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] get_by_id error: {e}")
            return self._fallback().get_by_id(item_id)

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        all_items = self.get_all()
        return [i for i in all_items if all(str(i.get(k)) == str(v) for k, v in filters.items())]

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        if not _is_configured():
            return self._fallback().insert(item)
        try:
            _execute([{
                "sql": f"INSERT OR REPLACE INTO {self.table_name} (id, data) VALUES (:id, :data)",
                "args": {
                    "id": str(item.get("id", "")),
                    "data": json.dumps(item, ensure_ascii=False)
                }
            }])
            return item
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] insert error: {e}")
            return self._fallback().insert(item)

    def update(self, item_id: str, updated: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().update(item_id, updated)
        try:
            current = self.get_by_id(item_id)
            if current is None:
                return None
            current.update(updated)
            self.insert(current)
            return current
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] update error: {e}")
            return self._fallback().update(item_id, updated)

    def delete(self, item_id: str) -> bool:
        if not _is_configured():
            return self._fallback().delete(item_id)
        try:
            _execute([{
                "sql": f"DELETE FROM {self.table_name} WHERE id = :id",
                "args": {"id": str(item_id)}
            }])
            return True
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] delete error: {e}")
            return self._fallback().delete(item_id)

    def delete_many(self, filter_column: str, filter_value: Any) -> int:
        if not _is_configured():
            return self._fallback().delete_many(filter_column, filter_value)
        try:
            all_items = self.get_all()
            to_delete = [i for i in all_items if str(i.get(filter_column)) == str(filter_value)]
            for item in to_delete:
                self.delete(str(item.get("id", "")))
            return len(to_delete)
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] delete_many error: {e}")
            return self._fallback().delete_many(filter_column, filter_value)

    def write(self, data: List[Dict[str, Any]]):
        if not _is_configured():
            return self._fallback().write(data)
        try:
            _execute([{"sql": f"DELETE FROM {self.table_name}"}])
            for item in data:
                self.insert(item)
        except Exception as e:
            print(f"[TursoGenericDB:{self.table_name}] write error: {e}")
            self._fallback().write(data)

    def clear_all(self):
        self.write([])
