"""Cold-process contracts for the single bundled Python namespace."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = ROOT / "python"


def production_modules():
    modules = []
    package = PYTHON_ROOT / "dsh_bot_runtime"
    for file in package.rglob("*.py"):
        relative = file.relative_to(PYTHON_ROOT).with_suffix("")
        parts = list(relative.parts)
        if parts[-1] == "__init__":
            parts.pop()
        name = ".".join(parts)
        if name and name not in modules:
            modules.append(name)
    return sorted(modules)


class NamespaceImportTests(unittest.TestCase):
    def _probe(self, modules):
        code = textwrap.dedent(f"""
            import importlib, json, os, pathlib, sys, threading, types
            names = {modules!r}
            for bare in ('model_usage', 'platform_links', 'transform_common', 'video_understanding_core', 'audio_output'):
                poisoned = types.ModuleType(bare)
                poisoned.POISONED = True
                sys.modules[bare] = poisoned
            events = []
            def audit(event, args):
                if event in ('socket.connect', 'socket.bind', 'subprocess.Popen', 'sqlite3.connect'):
                    events.append(event)
                if event == 'open':
                    mode = args[1]
                    flags = args[2]
                    if isinstance(mode, str) and any(value in mode for value in 'wax+') or isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
                        events.append('file-write')
                if event in ('os.mkdir', 'os.rename', 'os.replace', 'os.remove', 'os.rmdir'):
                    events.append(event)
            sys.addaudithook(audit)
            original_start = threading.Thread.start
            def start(self, *args, **kwargs):
                events.append('thread-start')
                return original_start(self, *args, **kwargs)
            threading.Thread.start = start
            before_path = list(sys.path)
            before_files = sorted(str(path.relative_to(pathlib.Path.cwd())) for path in pathlib.Path.cwd().rglob('*'))
            before_threads = {{thread.ident for thread in threading.enumerate()}}
            loaded = [importlib.import_module(name) for name in names]
            after_files = sorted(str(path.relative_to(pathlib.Path.cwd())) for path in pathlib.Path.cwd().rglob('*'))
            after_threads = {{thread.ident for thread in threading.enumerate()}}
            worker = importlib.import_module('dsh_bot_runtime.worker')
            registry = sorted(worker.skill_operations())
            music_entry = importlib.import_module('dsh_bot_runtime.skills.music_download.entry')
            singing_entry = importlib.import_module('dsh_bot_runtime.skills.singing_conversion.entry')
            assert music_entry is importlib.import_module('dsh_bot_runtime.skills.music_download.entry')
            assert singing_entry is importlib.import_module('dsh_bot_runtime.skills.singing_conversion.entry')
            assert music_entry is not singing_entry and music_entry.__name__ != singing_entry.__name__
            assert before_path == sys.path, (before_path, sys.path)
            assert before_files == after_files, (before_files, after_files)
            assert before_threads == after_threads, (before_threads, after_threads)
            assert not events, events
            assert all(module.__name__.startswith('dsh_bot_runtime') for module in loaded)
            assert importlib.import_module('dsh_bot_runtime.model_usage') is not sys.modules['model_usage']
            print(json.dumps(registry))
        """)
        with tempfile.TemporaryDirectory(dir=os.environ.get("BOT_TEST_TMP")) as directory:
            env = dict(os.environ)
            env["PYTHONPATH"] = str(PYTHON_ROOT)
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            result = subprocess.run(
                [sys.executable, "-B", "-P", "-c", code], cwd=directory, env=env,
                text=True, capture_output=True, timeout=60, check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        return json.loads(result.stdout)

    def test_all_modules_import_without_side_effects_in_any_order(self):
        modules = production_modules()
        forward = self._probe(modules)
        reverse = self._probe(list(reversed(modules)))
        self.assertEqual(forward, reverse)
        self.assertEqual(len(forward), 13)

    def test_imports_never_create_bytecode_or_cache_directories(self):
        caches = [path for path in PYTHON_ROOT.rglob("*") if path.name == "__pycache__" or path.suffix == ".pyc"]
        self.assertEqual(caches, [])


if __name__ == "__main__":
    unittest.main()
