import hashlib
import io
import os
import platform
import tarfile
import zipfile
from pathlib import Path

from download import download

VERSION = "0.11.24"
TARGETS = {
    ("Windows", "AMD64"): ("x86_64-pc-windows-msvc.zip", "af9573a2e36f7020b18ec5fdde20117aae74bbad3f4acb3dc3fc03319f1aa083"),
    ("Linux", "x86_64"): ("x86_64-unknown-linux-gnu.tar.gz", "5ce1ad074a78f96c5c8122088bb85a12eb282195bc1453151a48762e4fc31fed"),
    ("Darwin", "arm64"): ("aarch64-apple-darwin.tar.gz", "7578c6087c5cd76981732b1f5d126248101faebdf81016ba780a65ce03653cdf"),
    ("Darwin", "x86_64"): ("x86_64-apple-darwin.tar.gz", "8e026ec796a2760c33c832298b0910bf07fb369d00cc075761c321923ac37522"),
}


def main():
    archive, digest = TARGETS[(platform.system(), platform.machine())]
    url = f"https://github.com/astral-sh/uv/releases/download/{VERSION}/uv-{archive}"
    payload = download(url, timeout=60)
    if hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError("uv archive checksum mismatch")
    root = Path(__file__).resolve().parents[1] / "src-tauri" / "runtime"
    root.mkdir(exist_ok=True)
    executable = "uv.exe" if os.name == "nt" else "uv"
    if archive.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(payload)) as source:
            data = source.read(executable)
    else:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as source:
            member = next(m for m in source.getmembers() if m.isfile() and Path(m.name).name == executable)
            data = source.extractfile(member).read()
    target = root / executable
    target.write_bytes(data)
    target.chmod(0o755)
    for name in ["LICENSE-APACHE", "LICENSE-MIT"]:
        content = download(f"https://raw.githubusercontent.com/astral-sh/uv/{VERSION}/{name}")
        (root / name).write_bytes(content)
    print(f"Prepared uv {VERSION} ({archive})")


if __name__ == "__main__":
    main()
