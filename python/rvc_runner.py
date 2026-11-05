"""Compatibility CLI for the namespaced RVC runner."""
from dsh_bot_runtime.rvc_runner import main


if __name__ == "__main__":
    raise SystemExit(main())
