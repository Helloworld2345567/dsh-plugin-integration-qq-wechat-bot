import os
from pathlib import Path
import tempfile
import unittest

from dsh_bot_runtime.video_understanding.models import CallerContext, Limits, VideoError
from dsh_bot_runtime.video_understanding.store import JobStore


class MediaQuotaTests(unittest.TestCase):
    def test_video_usage_has_no_daily_job_or_duration_cap_and_keeps_ownership(self):
        root = Path(os.environ.get('BOT_TEST_TMP', Path(__file__).resolve().parents[1] / '.codex'))
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='media-unlimited-', dir=root) as folder:
            store = JobStore(Path(folder) / 'jobs.sqlite')
            self.addCleanup(store.db.close)
            caller = CallerContext('bot', 'user', 'session')
            limits = Limits()
            try:
                for index in range(105):
                    job = str(index)
                    store.reserve(job, caller, job, limits)
                    store.reserve_seconds(job, caller, 300, limits)
                usage = store.db.execute('SELECT jobs,seconds FROM daily_usage').fetchone()
                self.assertEqual(tuple(usage), (105, 31500))
                self.assertEqual(store.authorized('104', caller)['seconds'], 300)
                with self.assertRaisesRegex(VideoError, 'JOB_UNAVAILABLE'):
                    store.authorized('104', CallerContext('bot', 'another-user', 'session'))
            finally:
                store.db.close()
