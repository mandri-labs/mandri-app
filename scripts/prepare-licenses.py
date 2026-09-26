import json
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "src-tauri" / "runtime" / "licenses"
UPSTREAM_CACHE = {}


def copy_licenses(source, destination):
    files = [p for p in source.rglob("*") if p.is_file() and (
        p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "OFL"))
    ) and "node_modules" not in p.relative_to(source).parts]
    for path in files:
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    return bool(files)


def upstream_licenses(package, source, destination):
    if package.get("license") == "MPL-2.0":
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "LICENSE").write_bytes(urllib.request.urlopen(
            "https://www.mozilla.org/media/MPL/2.0/index.txt", timeout=30
        ).read())
        return
    repository = package.get("repository") or {
        "libappindicator-sys": "https://github.com/tauri-apps/libappindicator-rs",
    }.get(package["name"])
    vcs = json.loads((source / ".cargo_vcs_info.json").read_text())
    commit = vcs["git"]["sha1"]
    if not repository or not repository.startswith("https://github.com/"):
        raise ValueError(f"Cannot locate upstream license for {package['name']}")
    repository = repository.rstrip("/").removesuffix(".git")
    key = (repository, commit)
    if key not in UPSTREAM_CACHE:
        files = {}
        for name in ["LICENSE", "LICENSE.txt", "LICENSE.md", "LICENSE-MIT", "LICENSE-APACHE", "LICENSE_MIT", "LICENSE_APACHE-2.0", "COPYING"]:
            url = f"{repository.replace('github.com', 'raw.githubusercontent.com')}/{commit}/{name}"
            try:
                files[name] = urllib.request.urlopen(url, timeout=30).read()
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
        UPSTREAM_CACHE[key] = files
    if not UPSTREAM_CACHE[key]:
        raise ValueError(f"No upstream license found for {package['name']}")
    destination.mkdir(parents=True, exist_ok=True)
    for name, content in UPSTREAM_CACHE[key].items():
        (destination / name).write_bytes(content)


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / "package-lock.json").read_text())
    for name, package in lock["packages"].items():
        if not name or package.get("dev") or package.get("optional"):
            continue
        source = ROOT / name
        if not copy_licenses(source, DESTINATION / "npm" / name.removeprefix("node_modules/")):
            raise ValueError(f"No license text found for {name}")
    host = next(line.split(": ", 1)[1] for line in subprocess.check_output(
        ["rustc", "-vV"], text=True
    ).splitlines() if line.startswith("host: "))
    data = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--format-version", "1", "--manifest-path",
        str(ROOT / "src-tauri/Cargo.toml"), "--filter-platform", host,
    ]))
    active = {node["id"] for node in data["resolve"]["nodes"]}
    for package in data["packages"]:
        if package["source"] is None or package["id"] not in active:
            continue
        source = Path(package["manifest_path"]).parent
        destination = DESTINATION / "rust" / f"{package['name']}-{package['version']}"
        if not copy_licenses(source, destination):
            upstream_licenses(package, source, destination)
        if package.get("license") == "MPL-2.0":
            shutil.make_archive(str(destination / "source"), "gztar", source)
    print("Prepared third-party license texts and required covered source")


if __name__ == "__main__":
    main()
