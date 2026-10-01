"""網頁推播（Web Push）：選股結果出來時通知有開啟通知的人。"""
from __future__ import annotations

import json

from . import config, db


def send_to_user(conn, user_id, title: str, body: str, url: str = "/") -> int:
    """只推播給某一位使用者（策略、建倉提醒都是私人的）。"""
    return send_all(conn, title, body, url, user_id=user_id)


def send_all(conn, title: str, body: str, url: str = "/", user_id=None) -> int:
    if not config.VAPID_PRIVATE_KEY:
        print("[push] 未設定 VAPID_PRIVATE_KEY，略過推播")
        return 0
    from pywebpush import WebPushException, webpush

    if user_id is None:
        subs = db.query_df(conn, "select id, endpoint, p256dh, auth from public.push_subscriptions")
    else:
        subs = db.query_df(conn, "select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = %s",
                           (user_id,))
    sent = 0
    for s in subs.itertuples():
        try:
            webpush(
                subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                data=json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False),
                vapid_private_key=config.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": config.VAPID_SUBJECT},
                ttl=6 * 3600,
            )
            sent += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):  # 訂閱已失效
                db.execute(conn, "delete from public.push_subscriptions where id = %s", (s.id,))
            else:
                print(f"[push] 失敗：{e}")
    return sent
