import io
import unittest
import urllib.error
from unittest.mock import patch

from download import download


class DownloadTests(unittest.TestCase):
    def test_recovers_from_connection_reset(self):
        with patch('urllib.request.urlopen', side_effect=[ConnectionResetError(), io.BytesIO(b'license')]) as request:
            with patch('time.sleep'):
                self.assertEqual(download('https://example.org/license'), b'license')
        self.assertEqual(request.call_count, 2)

    def test_missing_license_is_not_retried(self):
        error = urllib.error.HTTPError('https://example.org/license', 404, 'missing', {}, None)
        with patch('urllib.request.urlopen', side_effect=error) as request:
            with self.assertRaises(urllib.error.HTTPError):
                download('https://example.org/license')
        self.assertEqual(request.call_count, 1)

    def test_server_failure_has_bounded_retries(self):
        error = urllib.error.HTTPError('https://example.org/license', 503, 'unavailable', {}, None)
        with patch('urllib.request.urlopen', side_effect=error) as request:
            with patch('time.sleep'):
                with self.assertRaises(urllib.error.HTTPError):
                    download('https://example.org/license')
        self.assertEqual(request.call_count, 4)


if __name__ == '__main__':
    unittest.main()
