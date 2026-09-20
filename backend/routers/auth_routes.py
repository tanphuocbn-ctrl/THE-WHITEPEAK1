import hashlib
import secrets
from datetime import datetime, timezone, timedelta

from bson import ObjectId
from fastapi import APIRouter, Request, Response, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, EmailStr

from db import db
import auth as A

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()


@router.post("/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email đã được đăng ký")
    doc = {
        "email": email, "password_hash": A.hash_password(body.password),
        "name": body.name, "role": "member", "token_version": 0,
        "created_at": A.datetime.now(timezone.utc).isoformat(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    at = A.create_access_token(uid, email, 0)
    rt = A.create_refresh_token(uid, 0)
    A.set_auth_cookies(response, at, rt)
    doc["_id"] = res.inserted_id
    return A.public_user(doc)


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ip = _ip(request)
    await A.check_lockout(ip, email)
    user = await db.users.find_one({"email": email})
    if not user or not A.verify_password(body.password, user["password_hash"]):
        await A.record_failed(ip, email)
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")
    await A.clear_attempts(ip, email)
    ver = user.get("token_version", 0)
    uid = str(user["_id"])
    A.set_auth_cookies(response, A.create_access_token(uid, email, ver), A.create_refresh_token(uid, ver))
    return A.public_user(user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Đã đăng xuất"}


@router.get("/me")
async def me(user: dict = Depends(A.get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Không có refresh token")
    try:
        payload = A.jwt.decode(token, A.get_jwt_secret(), algorithms=[A.JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Token không hợp lệ")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user or payload.get("ver", 0) != user.get("token_version", 0):
            raise HTTPException(status_code=401, detail="Phiên đã hết hạn")
    except A.jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token không hợp lệ")
    uid = str(user["_id"])
    A.set_auth_cookies(response, A.create_access_token(uid, user["email"], user.get("token_version", 0)),
                       A.create_refresh_token(uid, user.get("token_version", 0)))
    return A.public_user(user)


GENERIC_RESET = {"message": "Nếu email đã đăng ký, liên kết đặt lại đã được gửi."}


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, background_tasks: BackgroundTasks):
    email = body.email.lower()
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=A.RESET_WINDOW_MIN)
    await db.password_reset_requests.insert_one({"email": email, "created_at": now.isoformat()})
    count = await db.password_reset_requests.count_documents({"email": email, "created_at": {"$gt": window.isoformat()}})
    if count > A.RESET_MAX:
        return GENERIC_RESET
    user = await db.users.find_one({"email": email})
    if not user:
        return GENERIC_RESET
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    await db.password_reset_tokens.insert_one({
        "token_hash": token_hash, "user_id": str(user["_id"]), "email": user["email"],
        "expires_at": now + timedelta(hours=1), "used": False,
    })
    background_tasks.add_task(A.send_password_reset_email, user["email"], token)
    return GENERIC_RESET


@router.post("/reset-password")
async def reset_password(body: ResetIn):
    h = hashlib.sha256(body.token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    doc = await db.password_reset_tokens.find_one_and_update(
        {"token_hash": h, "used": False, "expires_at": {"$gt": now}},
        {"$set": {"used": True}},
    )
    if not doc:
        raise HTTPException(status_code=400, detail="Liên kết không hợp lệ hoặc đã hết hạn")
    await db.users.update_one(
        {"_id": ObjectId(doc["user_id"])},
        {"$set": {"password_hash": A.hash_password(body.password)}, "$inc": {"token_version": 1}},
    )
    await db.password_reset_tokens.delete_many({"user_id": doc["user_id"], "used": False})
    await db.login_attempts.delete_many({"email": doc["email"]})
    return {"message": "Đặt lại mật khẩu thành công"}
