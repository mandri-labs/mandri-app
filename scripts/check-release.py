import json
import os
import re
import tomllib
import urllib.request
from pathlib import Path


def check_versions(root: Path, tag: str | None = None) -> str:
    version = json.loads((root / "package.json").read_text())["version"]
    tauri = root / "src-tauri"
    versions = [
        json.loads((root / "package-lock.json").read_text())["version"],
        json.loads((root / "package-lock.json").read_text())["packages"][""]["version"],
        json.loads((tauri / "tauri.conf.json").read_text())["version"],
        tomllib.loads((tauri / "Cargo.toml").read_text())["package"]["version"],
        next(p["version"] for p in tomllib.loads((tauri / "Cargo.lock").read_text())["package"] if p["name"] == "mandri-app"),
    ]
    if any(value != version for value in versions):
        raise ValueError("Desktop version files disagree")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"Release tag must be v{version}, got {tag}")
    source = (tauri / "src/provision.rs").read_text()
    match = re.search(r'pub const BACKEND_VERSION: &str = "([^"]+)";', source)
    if not match or not re.fullmatch(r"[0-9][0-9A-Za-z.+-]*", match[1]):
        raise ValueError("Cannot determine pinned backend version")
    return match[1]


def check_backend(version: str) -> None:
    with urllib.request.urlopen(f"https://pypi.org/pypi/mandri/{version}/json", timeout=30) as response:
        release = json.load(response)
    if release["info"]["version"] != version:
        raise ValueError("PyPI backend version does not match")
    if not any(file["packagetype"] == "bdist_wheel" and not file.get("yanked", False) for file in release["urls"]):
        raise ValueError(f"mandri=={version} has no available wheel on PyPI")
    print(f"Verified mandri=={version} on PyPI")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    tag = os.environ.get("GITHUB_REF_NAME") if os.environ.get("GITHUB_REF_TYPE") == "tag" else None
    check_backend(check_versions(root, tag))


if __name__ == "__main__":
    main()
