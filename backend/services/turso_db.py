"""
Turso (libSQL) HTTP client for persistent company storage.

Uses Turso's REST pipeline API — stdlib urllib only, no extra packages.
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

# ── Config ──────────────────────────────────────────────────────────────────
_RAW_URL = os.environ.get("TURSO_DATABASE_URL", "")
_TOKEN   = os.environ.get("TURSO_AUTH_TOKEN", "")

# Convert libsql:// -> https://
_HTTP_URL = _RAW_URL.replace("libsql://", "https://") if _RAW_URL else ""

_DEFAULT_COMPANY = {
    "id":       "557f9b08-30da-4b99-b233-a16c9df5191d",
    "name":     "Logistix India Corp",
    "email":    "manager@logistix.com",
    "password": "password123",
}


def _is_configured() -> bool:
    return bool(_HTTP_URL and _TOKEN)


# ── Raw HTTP call to Turso pipeline ─────────────────────────────────────────
def _execute(statements: List[Dict]) -> List[Any]:
    """
    Execute one or more SQL statements via Turso HTTP pipeline.
    Each statement: {"sql": "...", "args": [...]}  (args optional)
    Returns list of result sets (one per statement).
    Raises on HTTP/network error.
    """
    if not _is_configured():
        raise RuntimeError("Turso not configured — env vars missing")

    requests = []
    for stmt in statements:
        req_obj = {
            "type": "execute",
            "stmt": {
                "sql": stmt["sql"],
                "named_args": [
                    {"name": k, "value": {"type": "text", "value": str(v)}}
                    for k, v in stmt.get("args", {}).items()
                ]
            }
        }
        requests.append(req_obj)
    requests.append({"type": "close"})

    payload = json.dumps({"requests": requests}).encode("utf-8")

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
        with urllib.request.urlopen(http_req, timeout=8) as resp:
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


# ── Table bootstrap ──────────────────────────────────────────────────────────
_TABLE_CREATED = False

def _ensure_table():
    global _TABLE_CREATED
    if _TABLE_CREATED:
        return
    _execute([{
        "sql": (
            "CREATE TABLE IF NOT EXISTS companies ("
            "  id       TEXT PRIMARY KEY,"
            "  name     TEXT NOT NULL,"
            "  email    TEXT NOT NULL UNIQUE,"
            "  password TEXT NOT NULL"
            ")"
        )
    }])
    # Seed default demo company (ignore if already exists)
    try:
        _execute([{
            "sql": "INSERT OR IGNORE INTO companies (id, name, email, password) VALUES (:id, :name, :email, :password)",
            "args": _DEFAULT_COMPANY
        }])
    except Exception:
        pass
    _TABLE_CREATED = True


# ── Row helpers ──────────────────────────────────────────────────────────────
def _row_to_dict(cols: List[str], row: List[Any]) -> Dict[str, Any]:
    """Turn a Turso row (list of {type, value}) into a plain dict."""
    return {
        col: (cell["value"] if isinstance(cell, dict) else cell)
        for col, cell in zip(cols, row)
    }


def _result_to_dicts(result: Dict) -> List[Dict[str, Any]]:
    cols = [c["name"] for c in result.get("cols", [])]
    return [_row_to_dict(cols, row) for row in result.get("rows", [])]


# ── Public API (mirrors JSONDatabase interface for companies) ─────────────────
class TursoCompaniesDB:
    """
    Persistent companies table backed by Turso (libSQL).
    Falls back to local JSONDatabase when Turso env vars are not set.
    """

    def __init__(self):
        if _is_configured():
            _ensure_table()
        else:
            print("[TursoDB] Turso not configured — falling back to local JSON")

    def _fallback(self):
        from backend.database import JSONDatabase
        return JSONDatabase("companies")

    # ── get_all ──────────────────────────────────────────────────────────────
    def get_all(self) -> List[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().get_all()
        try:
            results = _execute([{"sql": "SELECT id, name, email, password FROM companies"}])
            return _result_to_dicts(results[0]) if results else []
        except Exception as e:
            print(f"[TursoDB] get_all error: {e}")
            return self._fallback().get_all()

    # ── get_by_id ────────────────────────────────────────────────────────────
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

    # ── get_filtered ─────────────────────────────────────────────────────────
    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        all_items = self.get_all()
        return [
            item for item in all_items
            if all(str(item.get(k)) == str(v) for k, v in filters.items())
        ]

    # ── insert ───────────────────────────────────────────────────────────────
    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        if not _is_configured():
            return self._fallback().insert(item)
        try:
            _execute([{
                "sql": "INSERT OR REPLACE INTO companies (id, name, email, password) VALUES (:id, :name, :email, :password)",
                "args": {
                    "id":       item.get("id", ""),
                    "name":     item.get("name", ""),
                    "email":    item.get("email", ""),
                    "password": item.get("password", ""),
                }
            }])
            return item
        except Exception as e:
            print(f"[TursoDB] insert error: {e}")
            return self._fallback().insert(item)

    # ── update ───────────────────────────────────────────────────────────────
    def update(self, item_id: str, updated: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not _is_configured():
            return self._fallback().update(item_id, updated)
        try:
            # Fetch current, merge, re-insert
            current = self.get_by_id(item_id)
            if not current:
                return None
            current.update(updated)
            return self.insert(current)
        except Exception as e:
            print(f"[TursoDB] update error: {e}")
            return self._fallback().update(item_id, updated)

    # ── delete ───────────────────────────────────────────────────────────────
    def delete(self, item_id: str) -> bool:
        if not _is_configured():
            return self._fallback().delete(item_id)
        try:
            _execute([{
                "sql": "DELETE FROM companies WHERE id = :id",
                "args": {"id": item_id}
            }])
            return True
        except Exception as e:
            print(f"[TursoDB] delete error: {e}")
            return self._fallback().delete(item_id)
