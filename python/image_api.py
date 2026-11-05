"""Compatibility CLI for the namespaced image client."""
from dsh_bot_runtime.skills.image_generation.image_api import main


if __name__ == "__main__":
    raise SystemExit(main())
