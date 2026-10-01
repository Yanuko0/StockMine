"""在你自己的電腦執行一次，取得 Google 雲端硬碟授權（refresh token）。

步驟：
1. pip install google-auth-oauthlib
2. python scripts/google_auth.py <client_id> <client_secret>
3. 瀏覽器會開啟 Google 登入頁 → 用「要存資料的那個 Google 帳號」登入並同意
4. 終端機會印出 GDRIVE_REFRESH_TOKEN，貼到 GitHub Secrets

權限只有 drive.file：程式只能存取它自己建立的檔案。
"""
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

if len(sys.argv) != 3:
    print("用法：python scripts/google_auth.py <client_id> <client_secret>")
    sys.exit(1)

flow = InstalledAppFlow.from_client_config(
    {"installed": {"client_id": sys.argv[1], "client_secret": sys.argv[2],
                   "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                   "token_uri": "https://oauth2.googleapis.com/token",
                   "redirect_uris": ["http://localhost"]}},
    SCOPES,
)
creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
print("\n請把下面這串存到 GitHub Secrets 的 GDRIVE_REFRESH_TOKEN：\n")
print(creds.refresh_token)
