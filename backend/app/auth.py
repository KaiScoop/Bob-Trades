import os
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

bearer_scheme = HTTPBearer(auto_error=False)


class AuthenticatedUser(BaseModel):
    id: str
    email: str | None = None
    token: str | None = None


async def get_authenticated_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> AuthenticatedUser:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Bearer token required")

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not publishable_key:
        raise HTTPException(status_code=503, detail="Supabase Auth is not configured")

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "apikey": publishable_key,
                    "Authorization": f"Bearer {credentials.credentials}",
                },
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase Auth is unavailable") from error

    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    if not response.is_success:
        raise HTTPException(status_code=503, detail="Supabase Auth request failed")

    try:
        user = response.json()
        return AuthenticatedUser(
            id=user["id"],
            email=user.get("email"),
            token=credentials.credentials,
        )
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="Invalid Supabase Auth response") from error