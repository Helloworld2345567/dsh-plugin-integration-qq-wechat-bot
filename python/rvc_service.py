"""Compatibility CLI for the namespaced RVC service."""
from dsh_bot_runtime.rvc_service import main


if __name__ == "__main__":
    raise SystemExit(main())
