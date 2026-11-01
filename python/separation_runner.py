"""RVC/PyMSS vocal separation and deterministic post-conversion mixing."""
from __future__ import annotations

import subprocess
from pathlib import Path

from singing_common import SingingError, validate_separation, validate_wav


def _model_config(value, rvc_root):
    separation = validate_separation(value)
    if not separation or not separation["enabled"]:
        raise SingingError("SINGING_SEPARATION_UNCONFIGURED")
    try:
        from rvc.separation.catalog import get_model
        spec = get_model(separation["modelId"])
    except Exception:
        raise SingingError("SINGING_MODEL_INCOMPATIBLE") from None
    path = Path(separation["modelPath"]).expanduser().resolve()
    # The path is operator-owned, but must identify the selected catalog
    # checkpoint exactly. This prevents a tool supplied path from changing the
    # separation model or loading a similarly named arbitrary checkpoint.
    if path.name.casefold() != spec.filename.casefold() or not path.is_file():
        raise SingingError("SINGING_MODEL_INCOMPATIBLE")
    return separation, spec, path


def separate_audio(source, vocals_output, instrumental_output, separation, rvc_root, device="cuda", *, expected_duration=None):
    """Separate one decoded 44.1 kHz source into validated WAV stems."""
    separation, spec, model_path = _model_config(separation, rvc_root)
    try:
        from rvc.core.devices import DeviceConfig
        from rvc.separation.audio_io import load_audio, save_audio
        from rvc.separation.separator import MSSeparator

        runtime = DeviceConfig.create(device=device)
        mix, sample_rate = load_audio(source, sr=44100, mono=False)
        if not getattr(mix, "size", 0):
            raise ValueError("empty input")
        with MSSeparator(spec, model_path, runtime, device_ids=(0,), inference_params={"use_amp": runtime.is_half}) as separator_runtime:
            result = separator_runtime.separate(mix, stems=("vocals", "instrumental"))
        if "vocals" not in result or "instrumental" not in result:
            raise ValueError("required stems missing")
        save_audio(str(vocals_output), result["vocals"], sample_rate, "wav", {"wav_bit_depth": "PCM_16"})
        save_audio(str(instrumental_output), result["instrumental"], sample_rate, "wav", {"wav_bit_depth": "PCM_16"})
    except SingingError:
        raise
    except Exception:
        raise SingingError("SINGING_SEPARATION_FAILED") from None
    validate_wav(vocals_output, expected_duration=expected_duration, code="SINGING_AUDIO_INVALID")
    validate_wav(instrumental_output, expected_duration=expected_duration, code="SINGING_AUDIO_INVALID")
    return separation


def mix_audio(converted_vocals, instrumental, output, *, vocal_volume=1.0, instrumental_mix=True,
              expected_duration=None, timeout=None):
    """Align converted vocals to the instrumental and emit a finalized WAV."""
    vocal_volume = float(vocal_volume)
    if not 0 <= vocal_volume <= 2:
        raise SingingError("SINGING_CONFIG_INVALID")
    output = Path(output)
    if instrumental_mix:
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-nostdin", "-y",
                   "-i", str(instrumental), "-i", str(converted_vocals),
                   "-filter_complex", f"[0:a]aresample=44100,volume=1.0[i];[1:a]aresample=44100,volume={vocal_volume}[v];"
                   "[i][v]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.98[a]",
                   "-map", "[a]", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(output)]
    else:
        command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-nostdin", "-y",
                   "-i", str(converted_vocals), "-map", "0:a:0", "-ac", "2", "-ar", "44100",
                   "-c:a", "pcm_s16le", str(output)]
    try:
        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   timeout=timeout, check=False)
        if completed.returncode:
            raise SingingError("SINGING_MIX_FAILED")
    except subprocess.TimeoutExpired:
        raise SingingError("SINGING_TIMEOUT") from None
    except OSError:
        raise SingingError("SINGING_MIX_FAILED") from None
    validate_wav(output, expected_duration=expected_duration, code="SINGING_OUTPUT_INVALID")
    return output
