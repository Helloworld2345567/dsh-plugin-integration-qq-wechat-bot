"""Loopback RVC job adapter: a FIFO slot, isolated processes, confirmed cancellation.

Run with the Python interpreter that contains the installed ``rvc`` package.
Only operator configuration selects checkpoints; clients use rvc_http_v1.
"""
from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass, field
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

from dsh_bot_runtime.singing_common import ERROR_CODES, MAX_INTERMEDIATE_BYTES, MAX_SOURCE_BYTES, SingingError, validate_parameters, validate_wav

TERMINAL = {"succeeded", "failed", "cancelled"}


def runner_environment(home):
    allowed = ("PATH", "SYSTEMROOT", "WINDIR", "LANG", "CUDA_PATH", "CUDA_HOME",
               "CUDA_VISIBLE_DEVICES", "NVIDIA_VISIBLE_DEVICES")
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(HOME=str(home), USERPROFILE=str(home), APPDATA=str(home), LOCALAPPDATA=str(home),
               TEMP=str(home), TMP=str(home), PYTHONDONTWRITEBYTECODE="1",
               PYTHONIOENCODING="utf-8", PYTHONUTF8="1", PYTHONNOUSERSITE="1")
    return env


def stop_process_tree(process):
    """A return means the task and its FFmpeg descendants have stopped."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        result = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode and process.poll() is None:
            raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        raise SingingError("SINGING_SERVICE_STATE_UNKNOWN") from None


def _rmtree_onerror(function, path, _exc_info):
    """Retry read-only Windows cache entries without escaping the job root."""
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    except OSError:
        pass
    try:
        function(path)
    except OSError:
        # Cleanup is best effort.  A provider cache must not stop the FIFO
        # worker from accepting the next job or hide the result status.
        pass


def _remove_path(path):
    """Remove one job child, including nested provider caches and symlinks."""
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return
    except OSError:
        mode = 0
    try:
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            path.unlink(missing_ok=True)
        else:
            shutil.rmtree(path, onerror=_rmtree_onerror)
    except OSError:
        # A read-only directory can reject the first rmtree call before its
        # callback runs.  Make a second bounded attempt, still best effort.
        try:
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path, onerror=_rmtree_onerror)
            else:
                path.unlink(missing_ok=True)
        except OSError:
            pass


@dataclass
class Job:
    id: str
    parameters: dict
    directory: Path
    status: str = "queued"
    error: str | None = None
    process: subprocess.Popen | None = None
    cancelling: bool = False
    done: threading.Event = field(default_factory=threading.Event)
    finished_at: float | None = None

    def public(self):
        value = {"jobId": self.id, "status": self.status}
        if self.error:
            value["error"] = {"code": self.error}
        return value


class JobManager:
    def __init__(self, data_dir, rvc_root, python=sys.executable, device="cpu", *, command_factory=None,
                 max_storage_bytes=2 * 1024**3, retention_seconds=3600):
        base = Path(data_dir).resolve()
        base.mkdir(parents=True, exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(prefix="rvc-session-", dir=base))
        self.rvc_root, self.python, self.device = str(Path(rvc_root).resolve()), python, device
        self.command_factory = command_factory
        self.max_storage_bytes, self.retention_seconds = max_storage_bytes, retention_seconds
        self.jobs, self.queue = {}, deque()
        self.expired_ids = dict()
        self.condition = threading.Condition()
        self.active, self.closed, self.uncertain = None, False, False
        self.thread = threading.Thread(target=self._work, name="rvc-fifo", daemon=True)
        self.thread.start()

    def _prune(self):
        for job in list(self.jobs.values()):
            if job.finished_at and time.monotonic() - job.finished_at > self.retention_seconds:
                shutil.rmtree(job.directory, ignore_errors=True)
                del self.jobs[job.id]
                self.expired_ids[job.id] = True
                if len(self.expired_ids) > 4096:
                    del self.expired_ids[next(iter(self.expired_ids))]

    def submit(self, parameters, audio):
        parameters = validate_parameters(parameters)
        if not audio or len(audio) > MAX_SOURCE_BYTES:
            raise SingingError("SINGING_SOURCE_TOO_LARGE" if audio else "SINGING_AUDIO_INVALID")
        with self.condition:
            self._prune()
            if parameters["jobId"] in self.expired_ids:
                raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
            existing = self.jobs.get(parameters["jobId"])
            if existing:
                if existing.status == "cancelled" and not existing.parameters:
                    return existing.public()
                if existing.parameters != parameters:
                    raise SingingError("SINGING_JOB_CONFLICT")
                return existing.public()
            if self.closed or self.uncertain:
                raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
            pending = sum(job.status not in TERMINAL for job in self.jobs.values())
            used = sum(file.stat().st_size for file in self.directory.rglob("*") if file.is_file())
            if pending >= 8 or len(self.jobs) >= 4096 or used + len(audio) + (pending + 1) * MAX_INTERMEDIATE_BYTES > self.max_storage_bytes:
                raise SingingError("SINGING_QUEUE_FULL")
            directory = self.directory / parameters["jobId"]
            directory.mkdir()
            (directory / "input.bin").write_bytes(audio)
            record = {"parameters": parameters, "input": str(directory / "input.bin"),
                      "output": str(directory / "result.wav"), "status": str(directory / "status.json")}
            (directory / "job.json").write_text(json.dumps(record), encoding="utf-8")
            job = Job(parameters["jobId"], parameters, directory)
            self.jobs[job.id] = job
            self.queue.append(job)
            self.condition.notify_all()
            return job.public()

    def get(self, job_id):
        with self.condition:
            job = self.jobs.get(job_id)
            if not job:
                raise SingingError("SINGING_SERVICE_STATE_UNKNOWN" if job_id in self.expired_ids else "SINGING_JOB_NOT_FOUND")
            return job.public()

    def result(self, job_id):
        with self.condition:
            self.get(job_id)
            job = self.jobs[job_id]
            if job.status != "succeeded" or not (job.directory / "result.wav").is_file():
                raise SingingError("SINGING_RESULT_NOT_READY")
            return (job.directory / "result.wav").open("rb")

    def health(self):
        with self.condition:
            return {"protocol": "rvc_http_v1", "status": "unknown" if self.uncertain else "ready",
                    "activeJobId": self.active.id if self.active else None, "queued": len(self.queue)}

    def cancel(self, job_id):
        with self.condition:
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", job_id):
                raise SingingError("SINGING_CONFIG_INVALID")
            if job_id not in self.jobs and job_id not in self.expired_ids:
                # The host can kill its uploading worker before an in-flight
                # POST has reached submit(). Reserve the ID before acknowledging
                # cancellation so that a late POST cannot start inference.
                directory = self.directory / job_id
                directory.mkdir(exist_ok=True)
                job = Job(job_id, {}, directory)
                self.jobs[job_id] = job
                self._finish(job, "cancelled", "SINGING_CANCELLED")
                return job.public()
            self.get(job_id)
            job = self.jobs[job_id]
            if job.status in TERMINAL:
                return job.public()
            job.cancelling = True
            if job.status == "queued":
                self.queue.remove(job)
                self._finish(job, "cancelled", "SINGING_CANCELLED")
                return job.public()
            process = job.process
        try:
            if process is not None:
                stop_process_tree(process)
            if not job.done.wait(25):
                raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
        except Exception:
            with self.condition:
                self.uncertain = True
            raise SingingError("SINGING_SERVICE_STATE_UNKNOWN") from None
        return self.get(job_id)

    def _finish(self, job, status, error=None):
        job.status, job.error, job.finished_at = status, error, time.monotonic()
        if status == "failed":
            print(json.dumps({"jobId": job.id, "status": status, "error": {"code": error}}), file=sys.stderr, flush=True)
        # Successful bytes remain available for idempotent polling/result fetch.
        try:
            children = tuple(job.directory.iterdir())
        except OSError:
            children = ()
        for file in children:
            try:
                preserve_result = status == "succeeded" and file.name == "result.wav" and file.is_file() and not file.is_symlink()
            except OSError:
                preserve_result = False
            if not preserve_result:
                _remove_path(file)
        job.done.set()
        self.condition.notify_all()

    def _work(self):
        while True:
            with self.condition:
                ready = self.condition.wait_for(lambda: self.closed or (self.queue and not self.uncertain), timeout=60)
                self._prune()
                if self.closed:
                    return
                if not ready:
                    continue
                job = self.queue.popleft()
                self.active, job.status = job, "running"
                command = (self.command_factory(job) if self.command_factory else
                           [self.python, "-B", str(Path(__file__).resolve().parent.parent / "rvc_runner.py"),
                            "--job", str(job.directory / "job.json"), "--rvc-root", self.rvc_root, "--device", self.device])
                try:
                    with (job.directory / "runner.log").open("wb") as log:
                        job.process = subprocess.Popen(command, cwd=self.rvc_root, env=runner_environment(job.directory),
                                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=os.name != "nt",
                                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                except OSError:
                    self._finish(job, "failed", "SINGING_INFERENCE_FAILED")
                    self.active = None
                    continue
            job.process.wait()
            with self.condition:
                if job.cancelling:
                    self._finish(job, "cancelled", "SINGING_CANCELLED")
                else:
                    try:
                        status = json.loads((job.directory / "status.json").read_text(encoding="utf-8"))
                        if job.process.returncode or status.get("status") != "succeeded":
                            raise SingingError(status.get("error", {}).get("code", "SINGING_INFERENCE_FAILED"))
                        validate_wav(job.directory / "result.wav")
                        self._finish(job, "succeeded")
                    except Exception as error:
                        self._finish(job, "failed", error.code if isinstance(error, SingingError) else "SINGING_INFERENCE_FAILED")
                self.active = None

    def close(self):
        with self.condition:
            ids = [job.id for job in self.jobs.values() if job.status not in TERMINAL]
        for job_id in ids:
            self.cancel(job_id)
        with self.condition:
            self.closed = True
            self.condition.notify_all()
        self.thread.join(timeout=30)
        if self.thread.is_alive():
            raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
        shutil.rmtree(self.directory)


def parse_submission(content_type, body):
    if not content_type.lower().startswith("multipart/form-data;"):
        raise SingingError("SINGING_CONFIG_INVALID")
    message = BytesParser(policy=default).parsebytes(("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + body)
    parts = {}
    if not message.is_multipart():
        raise SingingError("SINGING_CONFIG_INVALID")
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name not in ("audio", "parameters") or name in parts:
            raise SingingError("SINGING_CONFIG_INVALID")
        parts[name] = part.get_payload(decode=True)
    try:
        if len(parts["parameters"]) > 32768:
            raise ValueError()
        return json.loads(parts["parameters"]), parts["audio"]
    except (KeyError, TypeError, ValueError):
        raise SingingError("SINGING_CONFIG_INVALID") from None


class Handler(BaseHTTPRequestHandler):
    server_version = "RVCAdapter/1"

    def log_message(self, *_args):
        pass

    def _json(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        manager = self.server.manager
        route = urlsplit(self.path).path
        if self.command == "GET" and route == "/health":
            self._json(200, manager.health())
            return
        if self.command == "POST" and route == "/v1/jobs":
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_SOURCE_BYTES + 65536:
                raise SingingError("SINGING_SOURCE_TOO_LARGE")
            self.connection.settimeout(30)
            body = self.rfile.read(length)
            if len(body) != length:
                raise SingingError("SINGING_AUDIO_INVALID")
            parameters, audio = parse_submission(self.headers.get("Content-Type", ""), body)
            self._json(202, manager.submit(parameters, audio))
            return
        match = re.fullmatch(r"/v1/jobs/([a-zA-Z0-9_-]{1,128})(/result)?", route)
        if not match:
            raise SingingError("SINGING_JOB_NOT_FOUND")
        job_id, result = match.groups()
        if self.command == "GET" and result:
            with manager.result(job_id) as audio:
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(os.fstat(audio.fileno()).st_size))
                self.end_headers()
                shutil.copyfileobj(audio, self.wfile, 64 * 1024)
        elif self.command == "GET" and not result:
            self._json(200, manager.get(job_id))
        elif self.command == "DELETE" and not result:
            self._json(200, manager.cancel(job_id))
        else:
            raise SingingError("SINGING_JOB_NOT_FOUND")

    def _handle(self):
        try:
            self._route()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            code = error.code if isinstance(error, SingingError) else "SINGING_CONFIG_INVALID"
            status = {"SINGING_JOB_NOT_FOUND": 404, "SINGING_RESULT_NOT_READY": 409,
                      "SINGING_JOB_CONFLICT": 409, "SINGING_QUEUE_FULL": 429,
                      "SINGING_SERVICE_STATE_UNKNOWN": 503, "SINGING_SOURCE_TOO_LARGE": 413}.get(code, 400)
            self._json(status, {"error": {"code": code}})

    do_POST = do_GET = do_DELETE = _handle


def create_server(manager, port=9881):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.manager = manager
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rvc-root", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--port", type=int, default=9881)
    args = parser.parse_args()
    manager = JobManager(args.data_dir, args.rvc_root, args.python, args.device)
    server = create_server(manager, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        manager.close()


if __name__ == "__main__":
    main()
