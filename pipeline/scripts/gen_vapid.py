"""產生網頁推播用的 VAPID 金鑰（只需要執行一次）。

pip install cryptography
python scripts/gen_vapid.py
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())
priv = key.private_numbers().private_value.to_bytes(32, "big")
pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731

print("GitHub Secrets → VAPID_PRIVATE_KEY =", b64(priv))
print("Vercel 環境變數 → NEXT_PUBLIC_VAPID_PUBLIC_KEY =", b64(pub))
