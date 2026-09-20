# Auth Testing Playbook (Film Studio Manager)

Admin: tanphuoc.bn@gmail.com / Studio@2026 (super_admin)
Demo users (all password Studio@2026): pm@studio.vn, lead@studio.vn, member@studio.vn, reviewer@studio.vn, editor@studio.vn, secretary@studio.vn

Auth uses httpOnly cookies (JWT). Endpoints under /api/auth: register, login, logout, me, refresh, forgot-password, reset-password.

## Quick checks
1. Login sets access_token + refresh_token cookies; /api/auth/me returns same user via cookie.
2. Register creates member; wrong password → 401; 5 fails → 429 lockout.
3. forgot-password: identical generic 200 for registered & unregistered. Registered creates one password_reset_tokens doc (sha256 token_hash, raw token not stored). Rate limit 5/15min per email.
4. reset-password: claim token atomically (used=true), update hash, bump token_version, clear login_attempts by email. Reuse fails.

For local reset-link capture, set FRONTEND_URL=http://localhost:3000 and restart backend to log the link; restore https origin after.
