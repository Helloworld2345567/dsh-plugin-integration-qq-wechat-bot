"""Compatibility CLI for the isolated video metadata worker."""
from dsh_bot_runtime.video_understanding.extract_worker import main


if __name__ == "__main__":
    raise SystemExit(main())
