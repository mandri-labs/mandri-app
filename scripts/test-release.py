import io
import json
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CHECK = runpy.run_path(str(ROOT / "scripts/check-release.py"))


class ReleaseTests(unittest.TestCase):
    def test_current_versions_and_tag(self):
        version = json.loads((ROOT / "package.json").read_text())["version"]
        self.assertTrue(CHECK["check_versions"](ROOT, f"v{version}"))

    def test_wrong_tag_rejected(self):
        with self.assertRaisesRegex(ValueError, "Release tag"):
            CHECK["check_versions"](ROOT, "v9.9.9")

    def test_missing_backend_rejected(self):
        with patch("urllib.request.urlopen", side_effect=OSError("404")):
            with self.assertRaises(OSError):
                CHECK["check_backend"]("0.0.4b0")

    def test_wheel_required_and_yanked_rejected(self):
        for files in ([], [{"packagetype": "sdist"}], [{"packagetype": "bdist_wheel", "yanked": True}]):
            with self.subTest(files=files):
                data = {"info": {"version": "0.0.4b0"}, "urls": files}
                with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(data).encode())):
                    with self.assertRaisesRegex(ValueError, "available wheel"):
                        CHECK["check_backend"]("0.0.4b0")

    def test_available_backend_accepted(self):
        data = {"info": {"version": "0.0.4b0"}, "urls": [{"packagetype": "bdist_wheel", "yanked": False}]}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(data).encode())):
            CHECK["check_backend"]("0.0.4b0")


if __name__ == "__main__":
    unittest.main()
