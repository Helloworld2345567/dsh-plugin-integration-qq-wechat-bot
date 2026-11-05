"""Framework-independent video contracts with lazy service construction."""
from .models import AnalysisRequest, CallerContext, Limits, VideoError

__all__ = ["VideoService", "AnalysisRequest", "CallerContext", "Limits", "VideoError"]


def __getattr__(name):
    if name == "VideoService":
        from dsh_bot_runtime.video_understanding.service import VideoService
        return VideoService
    raise AttributeError(name)
