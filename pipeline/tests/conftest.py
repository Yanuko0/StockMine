import pytest


@pytest.fixture(autouse=True)
def _table_cache(tmp_path, monkeypatch):
    """每個測試用自己的大表快取資料夾，避免測試之間互相影響。"""
    from twstock import localcache
    monkeypatch.setattr(localcache, "CACHE_DIR", tmp_path / "tables")
    localcache.reset_memory()
    yield
    localcache.reset_memory()
