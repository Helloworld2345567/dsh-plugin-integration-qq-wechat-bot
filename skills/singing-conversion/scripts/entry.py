"""Thin packaged skill entry point; inference orchestration lives in python/."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "python"))
from singing_worker import execute
