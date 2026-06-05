"""
Upstash Redis KV Store for persistent company data on Vercel.

Uses the Upstash REST HTTP API (no pip packages needed — stdlib urllib only).
Falls back to in-memory dict if env vars are not set (local dev).

Keys used:
  companies          -> JSON list of all company records
"""
import os
import json
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")

# In-memory fallback when Upstash is not configured
_memory_store: Dict[str, Any] = {}


def _is_configured() -> bool:
    return bool(UPSTASH_URL and UPSTASH_TOKEN)


def _redis_get(key: str) -> Optional[str]:
    """GET key from Upstash Redis via HTTP REST."""
    if not _is_configured():
        return _memory_store.get(key)
    try:
        req = urllib.request.Request(
            f"{UPSTASH_URL}/get/{key}",
            headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read())
            return body.get("result")  # None if key doesn't exist
    except Exception as e:
        print(f"[KV] GET error: {e}")
        return None


def _redis_set(key: str, value: str) -> bool:
    """SET key in Upstash Redis via HTTP REST."""
    if not _is_configured():
        _memory_store[key] = value
        return True
    try:
        encoded = value.encode("utf-8")
        req = urllib.request.Request(
            f"{UPSTASH_URL}/set/{key}",
            data=encoded,
            headers={
                "Authorization": f"Bearer {UPSTASH_TOKEN}",
                "Content-Type": "text/plain",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read())
            return body.get("result") == "OK"
    except Exception as e:
        print(f"[KV] SET error: {e}")
        return False


# ─── Companies KV helpers ────────────────────────────────────────────────────

COMPANIES_KEY = "logistix:companies"

# Default built-in company always present
_DEFAULT_COMPANY = {
    "id": "557f9b08-30da-4b99-b233-a16c9df5191d",
    "name": "Logistix India Corp",
    "email": "manager@logistix.com",
    "password": "password123",
}


def _load_companies() -> List[Dict[str, Any]]:
    raw = _redis_get(COMPANIES_KEY)
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                # Always ensure the default demo company is present
                ids = {c.get("id") for c in data}
                if _DEFAULT_COMPANY["id"] not in ids:
                    data.insert(0, _DEFAULT_COMPANY)
                return data
        except Exception:
            pass
    # First use or key missing — seed with default company
    companies = [_DEFAULT_COMPANY]
    _save_companies(companies)
    return companies


def _save_companies(companies: List[Dict[str, Any]]) -> bool:
    return _redis_set(COMPANIES_KEY, json.dumps(companies, ensure_ascii=False))


# ─── Public API (mirrors JSONDatabase interface) ─────────────────────────────

class CompaniesKVDatabase:
    """
    Persistent companies store backed by Upstash Redis (or in-memory fallback).
    Drop-in replacement for JSONDatabase("companies") — only for the companies table.
    """

    def get_all(self) -> List[Dict[str, Any]]:
        return _load_companies()

    def get_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        for c in self.get_all():
            if str(c.get("id")) == str(item_id):
                return c
        return None

    def get_filtered(self, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        items = self.get_all()
        result = []
        for item in items:
            if all(str(item.get(k)) == str(v) for k, v in filters.items()):
                result.append(item)
        return result

    def insert(self, item: Dict[str, Any]) -> Dict[str, Any]:
        companies = self.get_all()
        # Remove any existing record with same id (upsert behaviour)
        companies = [c for c in companies if str(c.get("id")) != str(item.get("id"))]
        companies.append(item)
        _save_companies(companies)
        return item

    def update(self, item_id: str, updated: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        companies = self.get_all()
        for i, c in enumerate(companies):
            if str(c.get("id")) == str(item_id):
                companies[i].update(updated)
                _save_companies(companies)
                return companies[i]
        return None

    def delete(self, item_id: str) -> bool:
        companies = self.get_all()
        orig = len(companies)
        companies = [c for c in companies if str(c.get("id")) != str(item_id)]
        if len(companies) < orig:
            _save_companies(companies)
            return True
        return False
