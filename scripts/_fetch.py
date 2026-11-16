"""Download a ZIP archive without ever keeping a truncated or invalid file.

Why this exists: ``urllib.request.urlopen`` followed by ``shutil.copyfileobj`` does not
notice a connection that the server closes early. ``http.client`` quietly returns the
bytes it got, so the script printed "[ok]" and left a half-written archive behind. A ZIP
keeps its index at the end of the file, so the truncated copy fails later with
"File is not a zip file".

``download_zip`` therefore:

1. writes to ``<dest>.part`` and only renames it once the archive is proven good
2. compares the bytes received with the size announced by the server
3. resumes an interrupted transfer with a ``Range`` header, with exponential backoff
4. checks the signature, the central directory and every CRC of the ZIP
5. fails with a readable message, including when the server answers with an HTML page

Standard library only.
"""

from __future__ import annotations

import http.client
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


USER_AGENT = "Polititia-data-refresh/1.0"
CHUNK_SIZE = 1 << 20


class DownloadError(RuntimeError):
    """The archive could not be downloaded."""


class IncompleteDownload(DownloadError):
    """The connection was cut. The partial file is kept and the transfer resumed."""


class InvalidArchive(DownloadError):
    """The server answered, but not with a usable ZIP. The partial file is discarded."""


def _expected_total(response, start: int) -> int | None:
    """Size of the complete file, read from the response headers."""
    content_range = response.headers.get("Content-Range")
    if content_range:
        match = re.search(r"/(\d+)$", content_range)
        if match:
            return int(match.group(1))
    length = response.headers.get("Content-Length")
    if length and length.isdigit():
        return start + int(length) if response.status == 206 else int(length)
    return None


def _fetch_once(url: str, part: Path, timeout: float) -> int | None:
    """One attempt, resuming at the current size of ``part``. Returns the expected size."""
    have = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    if have:
        headers["Range"] = f"bytes={have}-"
    request = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "").lower()
        if "html" in content_type or content_type.startswith("text/"):
            snippet = response.read(160)
            raise InvalidArchive(
                f"the server answered {content_type!r} instead of a ZIP: {snippet!r}"
            )
        if have and response.status != 206:
            have = 0  # the server ignored Range: start again from zero
        expected = _expected_total(response, have)
        with part.open("ab" if have else "wb") as handle:
            while True:
                chunk = response.read(CHUNK_SIZE)
                if not chunk:
                    break
                handle.write(chunk)
    return expected


def _check_zip(path: Path) -> None:
    with path.open("rb") as handle:
        magic = handle.read(4)
    if magic != b"PK\x03\x04":
        raise InvalidArchive(f"not a ZIP file (it starts with {magic!r})")
    if not zipfile.is_zipfile(path):
        raise InvalidArchive("unreadable ZIP: the central directory is missing")
    with zipfile.ZipFile(path) as archive:
        broken = archive.testzip()
    if broken:
        raise InvalidArchive(f"corrupt entry in the ZIP: {broken}")


def download_zip(
    url: str,
    dest: str | os.PathLike[str],
    *,
    attempts: int = 6,
    timeout: float = 60.0,
) -> Path:
    """Download ``url`` to ``dest``. ``dest`` only ever holds a complete, valid ZIP."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    part.unlink(missing_ok=True)

    print(f"[download] {url}", flush=True)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            expected = _fetch_once(url, part, timeout)
            size = part.stat().st_size
            if expected is not None and size != expected:
                raise IncompleteDownload(f"incomplete download: {size} of {expected} bytes")
            _check_zip(part)
            os.replace(part, dest)
            print(f"[ok] wrote {dest} ({size} bytes)", flush=True)
            return dest

        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 416:  # Range out of bounds: the partial file is unusable
                part.unlink(missing_ok=True)
            elif not (exc.code in (408, 425, 429) or exc.code >= 500):
                part.unlink(missing_ok=True)  # 403, 404...: retrying will not help
                raise DownloadError(f"HTTP {exc.code} for {url}") from exc
        except InvalidArchive as exc:
            last_error = exc
            part.unlink(missing_ok=True)
        except (IncompleteDownload, OSError, http.client.HTTPException) as exc:
            last_error = exc  # OSError covers URLError, resets and timeouts: keep the .part

        if attempt < attempts:
            wait = min(2**attempt, 30)
            kept = part.stat().st_size if part.exists() else 0
            print(
                f"[retry] attempt {attempt}/{attempts} failed "
                f"({type(last_error).__name__}: {last_error}); "
                f"{kept} bytes kept, trying again in {wait}s",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait)

    part.unlink(missing_ok=True)
    raise DownloadError(f"giving up after {attempts} attempts: {last_error}")
