"""One isolated RVC conversion using the installed rvc.vc public interface."""
from __future__ import annotations

import argparse
from dataclasses import replace
import json
import os
from pathlib import Path

from singing_common import SingingError, decode_audio, validate_parameters, validate_wav
from separation_runner import mix_audio, separate_audio


def validate_model(parameters):
    from rvc.vc.checkpoints import load_checkpoint, select_speaker

    model = Path(parameters["singingWeightsPath"])
    try:
        if model.suffix.lower() != ".pth" or not model.is_file():
            raise ValueError()
        checkpoint, metadata = load_checkpoint(model)
        if metadata.version != parameters["modelVersion"] or not metadata.uses_f0:
            raise ValueError()
        select_speaker(metadata, parameters["speakerId"])
    except Exception:
        raise SingingError("SINGING_MODEL_INCOMPATIBLE") from None
    index_path = parameters.get("singingIndexPath")
    if index_path:
        try:
            import faiss
            # Validate even when the configured rate is zero: a configured broken
            # index must not silently turn into non-retrieval inference.
            with Path(index_path).open("rb") as index_file:
                index = faiss.read_index(faiss.PyCallbackIOReader(index_file.read))
            if index.d != (256 if metadata.version == "v1" else 768) or index.ntotal <= 0:
                raise ValueError()
        except Exception:
            raise SingingError("SINGING_INDEX_INVALID") from None
    return model, checkpoint


def convert(parameters, source, output, rvc_root, device, *, source_duration=None, validate_duration=True):
    # Config creation also enables process-global HuBERT/RMVPE capture. Setting
    # only config.cuda_graph=False afterwards leaves those captures active.
    # Each runner owns one isolated job; long songs use eager CUDA execution.
    os.environ["RVC_CUDA_GRAPH"] = "0"
    parameters = validate_parameters(parameters)
    decoded = Path(output).with_name("source.wav")
    if source_duration is None:
        source_duration = decode_audio(source, decoded)
    else:
        # A separated vocals stem is already a strict PCM WAV. The RVC loader
        # still receives a private copy so output and input never alias.
        decoded.write_bytes(Path(source).read_bytes())
    model, checkpoint = validate_model(parameters)
    from rvc.vc.audio import write_audio
    from rvc.vc.config import VoiceConversionConfig
    from rvc.vc.engine import VoiceConverter

    config = VoiceConversionConfig.create(device, resource_base=Path(rvc_root))
    config = replace(config, cuda_graph=False)
    with VoiceConverter(model, config, checkpoint=checkpoint) as converter:
        result = converter.convert(decoded, speaker_id=parameters["speakerId"], pitch=parameters["pitchShift"],
                                   f0_method="rmvpe", index_path=parameters.get("singingIndexPath"),
                                   index_rate=parameters["indexRate"], resample_sr=0, rms_mix_rate=1.0, protect=0.33)
        write_audio(Path(output), result.audio, result.sample_rate, "wav")
    validate_wav(output, expected_duration=source_duration if validate_duration else None)


def convert_mixed(parameters, source, output, rvc_root, device):
    parameters = validate_parameters(parameters)
    separation = parameters.get("separation")
    if not separation or not separation.get("enabled"):
        raise SingingError("SINGING_SEPARATION_UNCONFIGURED")
    work = Path(output).parent
    original = work / "separation-source.wav"
    original_duration = decode_audio(source, original, sample_rate=44100, mono=False)
    vocals = work / "separated-vocals.wav"
    instrumental = work / "separated-instrumental.wav"
    separate_audio(original, vocals, instrumental, separation, rvc_root, device,
                   expected_duration=original_duration)
    converted = work / "converted-vocals.wav"
    # RVC operates on vocals only. It outputs the target model's sample rate;
    # mix_audio resamples it back to the separator's timeline and channel layout.
    # Some RVC checkpoints emit a different number of frames around segment
    # boundaries. The instrumental timeline is authoritative; mix_audio trims
    # or pads the converted stem while still rejecting malformed output.
    convert(parameters, vocals, converted, rvc_root, device, source_duration=original_duration,
            validate_duration=False)
    mix_audio(converted, instrumental, output, instrumental_mix=separation["instrumentalMix"],
              vocal_volume=separation["volume"], expected_duration=original_duration)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--rvc-root", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()
    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    status = {"status": "succeeded"}
    try:
        if job["parameters"].get("sourceType") == "mixed":
            convert_mixed(job["parameters"], job["input"], job["output"], args.rvc_root, args.device)
        else:
            convert(job["parameters"], job["input"], job["output"], args.rvc_root, args.device)
    except Exception as error:
        status = {"status": "failed", "error": {"code": error.code if isinstance(error, SingingError) else "SINGING_INFERENCE_FAILED"}}
    Path(job["status"]).write_text(json.dumps(status), encoding="utf-8")
    return 0 if status["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
