import asyncio
from dataclasses import replace
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python/vendor'))
sys.path.insert(0, str(ROOT / 'skills/media-analysis/scripts'))

import media_api
from video_understanding_core.models import CallerContext, Limits, VideoError
from video_understanding_core.sources import SourceResolver
from video_understanding_core.store import JobStore

spec = importlib.util.spec_from_file_location('quota_worker', ROOT / 'python/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class MediaQuotaTests(unittest.TestCase):
    def setUp(self):
        temporary = ROOT / '.codex/trusted-media-unlimited-20261031/python-tests'
        temporary.mkdir(parents=True, exist_ok=True)
        directory = tempfile.TemporaryDirectory(dir=temporary)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.store = JobStore(self.root / 'jobs.sqlite')
        self.addCleanup(self.store.db.close)
        self.caller = CallerContext('bot', 'user', 'session')
        self.trusted = replace(self.caller, daily_quota_exempt=True)

    def job(self, **extra):
        return dict(id='fixture', scope='scope', operation='video_analyze', handler='skill',
                    inputs=[], parameters={'url': 'https://www.douyin.com/video/123'},
                    output=str(self.root), deadline=0, timeoutMs=0,
                    endpoint={'baseUrl': 'https://example.invalid/v1', 'model': 'fixture', 'keyEnv': 'TEST_QUOTA_KEY'},
                    **extra)

    def usage(self, user='user'):
        return self.store.db.execute('SELECT jobs,seconds FROM daily_usage WHERE day=? AND quota_user=?',
                                     (self.store.day(), user)).fetchone()

    def test_trusted_caller_exceeds_user_daily_job_budget_and_retains_accounting(self):
        limits = Limits(daily_jobs_per_user=1)
        self.store.reserve('initial', self.caller, 'initial', limits)
        with self.assertRaisesRegex(VideoError, 'DAILY_BUDGET_EXCEEDED'):
            self.store.reserve('denied', self.caller, 'denied', limits)
        for index in range(3):
            job_id = f'trusted-{index}'
            self.store.reserve(job_id, self.trusted, job_id, limits)
            self.store.reserve_seconds(job_id, self.trusted, 300, limits)
        self.assertEqual(tuple(self.usage()), (4, 900))
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 4)
        with self.assertRaisesRegex(VideoError, 'DAILY_BUDGET_EXCEEDED'):
            self.store.reserve('still-denied', self.caller, 'still-denied', limits)
        self.assertEqual(self.trusted.scope, self.caller.scope)
        self.assertEqual(self.store.authorized('trusted-0', self.caller)['seconds'], 300)
        other = CallerContext('bot', 'another-user', 'session', daily_quota_exempt=True)
        with self.assertRaisesRegex(VideoError, 'JOB_UNAVAILABLE'):
            self.store.authorized('trusted-0', other)

    def test_trusted_caller_exceeds_user_daily_seconds_and_retains_accounting(self):
        limits = Limits(daily_seconds_per_user=300)
        self.store.reserve('initial', self.caller, 'initial', limits)
        self.store.reserve_seconds('initial', self.caller, 300, limits)
        with self.assertRaisesRegex(VideoError, 'DAILY_DURATION_EXCEEDED'):
            self.store.reserve_seconds('initial', self.caller, 1, limits)
        for index in range(3):
            job_id = f'trusted-{index}'
            self.store.reserve(job_id, self.trusted, job_id, limits)
            self.store.reserve_seconds(job_id, self.trusted, 300, limits)
        self.assertEqual(tuple(self.usage()), (4, 1200))
        with self.assertRaisesRegex(VideoError, 'DAILY_DURATION_EXCEEDED'):
            self.store.reserve_seconds('initial', self.caller, 1, limits)

    def test_trusted_caller_exceeds_global_daily_budgets(self):
        limits = Limits(daily_total_jobs=1, daily_total_seconds=300)
        self.store.reserve('initial', self.caller, 'initial', limits)
        self.store.reserve_seconds('initial', self.caller, 300, limits)
        second = CallerContext('bot', 'second-user', 'session')
        with self.assertRaisesRegex(VideoError, 'DAILY_BUDGET_EXCEEDED'):
            self.store.reserve('denied', second, 'denied', limits)
        with self.assertRaisesRegex(VideoError, 'DAILY_DURATION_EXCEEDED'):
            self.store.reserve_seconds('initial', self.caller, 1, limits)
        trusted_second = replace(second, daily_quota_exempt=True)
        for index in range(3):
            job_id = f'trusted-{index}'
            self.store.reserve(job_id, trusted_second, job_id, limits)
            self.store.reserve_seconds(job_id, trusted_second, 300, limits)
        self.assertEqual(tuple(self.usage('second-user')), (3, 900))
        self.assertEqual(tuple(self.store.db.execute('SELECT SUM(jobs),SUM(seconds) FROM daily_usage').fetchone()), (4, 1200))

    def test_quota_exemption_protocol_accepts_only_boolean_top_level_values(self):
        for value in (True, False):
            with self.subTest(value=value):
                worker._validate_protocol(self.job(dailyQuotaExempt=value))
        for value in (None, 0, 1, 'true', [], {}):
            with self.subTest(value=value), self.assertRaisesRegex(worker.JobError, 'MEDIA_WORKER_QUOTA_INVALID'):
                worker._validate_protocol(self.job(dailyQuotaExempt=value))
        job = self.job()
        job['parameters']['dailyQuotaExempt'] = True
        worker._validate_protocol(job)
        self.assertNotIn('dailyQuotaExempt', job)

    def test_media_api_uses_host_flag_and_ignores_forged_parameter(self):
        import video_understanding_core
        for index, flag in enumerate((None, False, True)):
            with self.subTest(host_flag=flag):
                output = self.root / str(index)
                output.mkdir()
                observed = {}

                class Service:
                    def __init__(inner, root, backend, *, limits, resolver):
                        inner.store = JobStore(root / 'jobs.sqlite')
                        inner.limits = limits
                        plain = CallerContext('scope', 'scope', 'scope')
                        inner.store.reserve('initial', plain, 'initial', limits)
                        inner.store.reserve_seconds('initial', plain, limits.daily_seconds_per_user, limits)

                    async def submit(inner, request, caller):
                        observed['exempt'] = caller.daily_quota_exempt
                        inner.store.reserve('requested', caller, 'requested', inner.limits)
                        inner.store.reserve_seconds('requested', caller, 300, inner.limits)
                        observed['accounting'] = tuple(inner.store.db.execute('SELECT jobs,seconds FROM daily_usage').fetchone())
                        return {'job_id': 'requested'}

                    async def wait(inner, *args, **kwargs):
                        return {'status': 'COMPLETE'}

                    async def close(inner):
                        inner.store.db.close()

                job = self.job()
                job['output'] = str(output)
                job['parameters']['dailyQuotaExempt'] = True
                if flag is not None:
                    job['dailyQuotaExempt'] = flag
                with patch.dict(os.environ, {'TEST_QUOTA_KEY': 'fixture'}), patch.object(video_understanding_core, 'VideoService', Service):
                    if flag is True:
                        result = asyncio.run(media_api.analyze_video(job))
                        self.assertFalse(result['incomplete'])
                        self.assertEqual(observed['accounting'], (2, 2100))
                    else:
                        with self.assertRaisesRegex(VideoError, 'DAILY_BUDGET_EXCEEDED'):
                            asyncio.run(media_api.analyze_video(job))
                self.assertIs(observed['exempt'], flag is True)

    def test_exemption_preserves_attachment_count_and_storage_budgets(self):
        source = self.root / 'source.mp4'
        source.write_bytes(b'fixture')
        limits = Limits(max_download_bytes=64, max_inline_bytes=32, max_request_bytes=64,
                        max_storage_bytes=1024, daily_jobs_per_user=1)
        resolver = SourceResolver(self.root / 'count', limits)
        resolver.register_file(source, self.trusted)
        with self.assertRaisesRegex(VideoError, 'ATTACHMENT_LIMIT'):
            resolver.register_file(source, self.trusted)
        resolver = SourceResolver(self.root / 'storage', replace(limits, daily_jobs_per_user=10, max_storage_bytes=64))
        resolver.register_file(source, self.trusted)
        with self.assertRaisesRegex(VideoError, 'STORAGE_BUDGET_EXCEEDED'):
            resolver.register_file(source, self.trusted)


if __name__ == '__main__':
    unittest.main()
