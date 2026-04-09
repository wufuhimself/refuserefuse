import os
from typing import Optional
from uuid import uuid4

from fastapi import UploadFile


class LocalStorageBackend:
    def __init__(self, upload_dir: str):
        self.upload_dir = upload_dir
        os.makedirs(self.upload_dir, exist_ok=True)

    @property
    def serves_local_uploads(self) -> bool:
        return True

    async def save_upload(self, file: UploadFile) -> str:
        ext = os.path.splitext(file.filename or "")[1]
        filename = f"{uuid4().hex}{ext}"
        dest = os.path.join(self.upload_dir, filename)
        with open(dest, "wb") as f:
            content = await file.read()
            f.write(content)
        return f"/uploads/{filename}"


class S3StorageBackend:
    def __init__(
        self,
        bucket: str,
        region: Optional[str] = None,
        prefix: str = "uploads",
        public_base_url: Optional[str] = None,
    ):
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("STORAGE_BACKEND=s3 requires boto3 to be installed") from exc

        self.bucket = bucket
        self.region = region
        self.prefix = prefix.strip("/")
        self.public_base_url = public_base_url.rstrip("/") if public_base_url else None
        self.client = boto3.client("s3", region_name=region)

    @property
    def serves_local_uploads(self) -> bool:
        return False

    async def save_upload(self, file: UploadFile) -> str:
        ext = os.path.splitext(file.filename or "")[1]
        filename = f"{uuid4().hex}{ext}"
        key = f"{self.prefix}/{filename}" if self.prefix else filename
        body = await file.read()

        put_kwargs = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": body,
        }
        if file.content_type:
            put_kwargs["ContentType"] = file.content_type

        self.client.put_object(**put_kwargs)

        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        if self.region and self.region != "us-east-1":
            return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"


def create_storage_backend(base_dir: str):
    backend = os.getenv("STORAGE_BACKEND", "local").strip().lower()

    if backend == "s3":
        bucket = os.getenv("S3_BUCKET")
        if not bucket:
            raise RuntimeError("S3_BUCKET is required when STORAGE_BACKEND=s3")
        region = os.getenv("S3_REGION") or None
        prefix = os.getenv("S3_PREFIX", "uploads")
        public_base_url = os.getenv("S3_PUBLIC_BASE_URL") or None
        return S3StorageBackend(
            bucket=bucket,
            region=region,
            prefix=prefix,
            public_base_url=public_base_url,
        )

    upload_dir = os.getenv("STORAGE_LOCAL_DIR", os.path.join(base_dir, "uploads"))
    return LocalStorageBackend(upload_dir=upload_dir)
