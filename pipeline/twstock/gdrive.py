"""Google 雲端硬碟封存 / 備份。

授權：在自己電腦執行一次 `python scripts/google_auth.py`，用你指定的 Google 帳號登入，
會得到 GDRIVE_REFRESH_TOKEN，存到 GitHub Secrets 即可。
權限範圍只有 drive.file：程式只能看到它自己建立的檔案，碰不到帳號裡其他東西。
"""
from __future__ import annotations

import io

from . import config

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
FOLDER_MIME = "application/vnd.google-apps.folder"


def enabled() -> bool:
    return bool(config.GDRIVE_CLIENT_ID and config.GDRIVE_CLIENT_SECRET and config.GDRIVE_REFRESH_TOKEN)


_svc = None
_folder_cache: dict[str, str] = {}


def _service():
    global _svc
    if _svc is None:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            None, refresh_token=config.GDRIVE_REFRESH_TOKEN, client_id=config.GDRIVE_CLIENT_ID,
            client_secret=config.GDRIVE_CLIENT_SECRET, token_uri="https://oauth2.googleapis.com/token",
            scopes=SCOPES,
        )
        _svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _svc


def _folder(path: str) -> str:
    """確保資料夾路徑存在（例如 '掘股 StockMine/分鐘K/2026/10'），回傳資料夾 id。"""
    if path in _folder_cache:
        return _folder_cache[path]
    parent = "root"
    built = ""
    for part in [p for p in path.split("/") if p]:
        built = f"{built}/{part}" if built else part
        if built in _folder_cache:
            parent = _folder_cache[built]
            continue
        q = (f"name = '{part}' and mimeType = '{FOLDER_MIME}' and '{parent}' in parents and trashed = false")
        res = _service().files().list(q=q, fields="files(id)", spaces="drive").execute()
        if res["files"]:
            fid = res["files"][0]["id"]
        else:
            fid = _service().files().create(
                body={"name": part, "mimeType": FOLDER_MIME, "parents": [parent]}, fields="id").execute()["id"]
        _folder_cache[built] = fid
        parent = fid
    return parent


def upload_bytes(folder: str, name: str, data: bytes, mime: str = "application/octet-stream") -> str:
    """上傳（同名檔案會覆蓋）。folder 為相對於根資料夾的路徑。"""
    from googleapiclient.http import MediaIoBaseUpload

    fid = _folder(f"{config.GDRIVE_ROOT_FOLDER}/{folder}")
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=len(data) > 5_000_000)
    q = f"name = '{name}' and '{fid}' in parents and trashed = false"
    existing = _service().files().list(q=q, fields="files(id)").execute()["files"]
    if existing:
        return _service().files().update(fileId=existing[0]["id"], media_body=media, fields="id").execute()["id"]
    return _service().files().create(body={"name": name, "parents": [fid]}, media_body=media,
                                     fields="id").execute()["id"]


def list_files(folder: str) -> list[dict]:
    fid = _folder(f"{config.GDRIVE_ROOT_FOLDER}/{folder}")
    res = _service().files().list(q=f"'{fid}' in parents and trashed = false",
                                  fields="files(id,name,createdTime)", orderBy="createdTime").execute()
    return res["files"]


def delete(file_id: str) -> None:
    _service().files().delete(fileId=file_id).execute()
