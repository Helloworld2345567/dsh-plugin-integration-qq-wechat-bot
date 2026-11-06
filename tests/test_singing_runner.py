from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import io
import struct
import wave
import os
import shutil
from dataclasses import dataclass

ROOT = Path(__file__).resolve().parents[1]
from dsh_bot_runtime.rvc_runner import validate_model
from dsh_bot_runtime.singing_common import SingingError, validate_wav
from dsh_bot_runtime.separation_runner import mix_audio, _model_config

FFMPEG_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


class SingingRunnerTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".codex").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="singing-model-test-", dir=ROOT / ".codex")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.model = self.root / "fixture.pth"
        self.model.write_bytes(b"fixture")
        self.parameters = {"singingWeightsPath": str(self.model), "modelVersion": "v2", "speakerId": 1}
        self.metadata = SimpleNamespace(version="v2", uses_f0=True, speaker_count=2)
        self.checkpoints = ModuleType("rvc.vc.checkpoints")
        self.checkpoints.load_checkpoint = lambda path: ({"weight": {}}, self.metadata)
        def speaker(metadata, speaker_id):
            if not 0 <= speaker_id < metadata.speaker_count:
                raise ValueError("private traceback")
            return speaker_id
        self.checkpoints.select_speaker = speaker

    def test_version_pitch_condition_and_speaker_range_are_enforced(self):
        with patch.dict(sys.modules, {"rvc.vc.checkpoints": self.checkpoints}):
            self.assertEqual(validate_model(self.parameters)[0], self.model)
            for name, value in (("version", "v1"), ("uses_f0", False), ("speaker_count", 1)):
                previous = getattr(self.metadata, name)
                setattr(self.metadata, name, value)
                with self.subTest(field=name), self.assertRaisesRegex(SingingError, "SINGING_MODEL_INCOMPATIBLE"):
                    validate_model(self.parameters)
                setattr(self.metadata, name, previous)

    def test_configured_index_is_checked_even_at_zero_rate_and_unicode_path_works(self):
        path = self.root / "角色索引.index"
        path.write_bytes(b"fixture-index")
        parameters = {**self.parameters, "singingIndexPath": str(path), "indexRate": 0}
        faiss = ModuleType("faiss")
        faiss.PyCallbackIOReader = lambda callback: callback
        index = SimpleNamespace(d=768, ntotal=10)
        def load(callback):
            self.assertEqual(callback(100), b"fixture-index")
            return index
        faiss.read_index = load
        with patch.dict(sys.modules, {"rvc.vc.checkpoints": self.checkpoints, "faiss": faiss}):
            validate_model(parameters)
            index.d = 256
            with self.assertRaisesRegex(SingingError, "SINGING_INDEX_INVALID"):
                validate_model(parameters)
            path.unlink()
            with self.assertRaisesRegex(SingingError, "SINGING_INDEX_INVALID"):
                validate_model(parameters)

    def test_separation_model_accepts_exact_catalog_and_migration_names_only(self):
        filename = "model_bs_roformer_ep_368_sdr_12.9628.ckpt"
        spec = SimpleNamespace(name="vocals", filename=filename)
        catalog = ModuleType("rvc.separation.catalog")
        catalog.get_model = lambda model_id: spec
        separation = {"status": "configured", "enabled": True, "modelId": "vocals",
                      "instrumentalMix": True, "volume": 1.0}
        with patch.dict(sys.modules, {"rvc.separation.catalog": catalog}):
            for name in (filename, "modelPath-" + filename):
                with self.subTest(accepted=name):
                    model = self.root / name
                    model.write_bytes(b"fixture")
                    _, selected_spec, selected = _model_config({**separation, "modelPath": str(model)}, self.root)
                    self.assertIs(selected_spec, spec)
                    self.assertEqual(selected, model.resolve())
                    model.unlink()
            for name in ("arbitrary-" + filename, "modelPath-modelPath-" + filename,
                         "modelPath-wrong.ckpt", filename + ".bak", filename):
                with self.subTest(rejected=name):
                    model = self.root / name
                    if name != filename:
                        model.write_bytes(b"fixture")
                    with self.assertRaisesRegex(SingingError, "SINGING_MODEL_INCOMPATIBLE"):
                        _model_config({**separation, "modelPath": str(model)}, self.root)

    def test_separation_model_is_catalog_bound_and_mixing_is_duration_aligned(self):
        configured_root = os.environ.get("RVC_ROOT")
        if not configured_root or not Path(configured_root).is_dir():
            self.skipTest("Set RVC_ROOT to an available RVC checkout")
        rvc_root = Path(configured_root)
        sys.path.insert(0, str(rvc_root))
        self.addCleanup(lambda: sys.path.remove(str(rvc_root)))
        model = self.root / "model_bs_roformer_ep_368_sdr_12.9628.ckpt"
        model.write_bytes(b"fixture")
        separation = {"status": "configured", "enabled": True, "modelId": "vocals",
                      "modelPath": str(model), "instrumentalMix": True, "volume": 0.8}
        _, spec, selected = _model_config(separation, rvc_root)
        self.assertEqual(spec.name, "vocals")
        self.assertEqual(selected, model.resolve())
        source = self.root / "instrumental.wav"
        vocal = self.root / "converted.wav"
        final = self.root / "mixed.wav"
        def write(path, amplitude):
            stream = io.BytesIO()
            with wave.open(stream, "wb") as output:
                output.setparams((2, 2, 44100, 0, "NONE", "not compressed"))
                output.writeframes(b"".join(struct.pack("<hh", amplitude if index % 100 < 50 else -amplitude,
                                                        amplitude if index % 100 < 50 else -amplitude) for index in range(44100)))
            Path(path).write_bytes(stream.getvalue())
        write(source, 5000)
        write(vocal, 7000)
        mix_audio(vocal, source, final, vocal_volume=0.8, instrumental_mix=True, expected_duration=1)
        self.assertAlmostEqual(validate_wav(final, expected_duration=1), 1, places=2)
        with self.assertRaisesRegex(SingingError, "SINGING_MODEL_INCOMPATIBLE"):
            _model_config({**separation, "modelPath": str(self.root / "wrong.ckpt")}, rvc_root)

    @unittest.skipUnless(FFMPEG_AVAILABLE, "FFmpeg required")
    def test_mixed_runner_separates_then_converts_then_mixes_once(self):
        source = self.root / "mix.wav"
        stream = io.BytesIO()
        with wave.open(stream, "wb") as output:
            output.setparams((2, 2, 44100, 0, "NONE", "not compressed"))
            output.writeframes(b"".join(struct.pack("<hh", 5000, -5000) for _ in range(44100)))
        source.write_bytes(stream.getvalue())
        output = self.root / "result.wav"
        separation_path = self.root / "model_bs_roformer_ep_368_sdr_12.9628.ckpt"
        separation_path.write_bytes(b"fixture")
        parameters = {"jobId": "mixed", "modelVersion": "v2", "singingModelId": "fixture",
                      "singingWeightsPath": str(self.model), "speakerId": 0, "pitchShift": 0, "indexRate": 0,
                      "sourceType": "mixed", "separation": {"status": "configured", "enabled": True,
                      "modelId": "vocals", "modelPath": str(separation_path), "instrumentalMix": True, "volume": 1.0}}
        calls = []
        def fake_separate(source_path, vocals_path, instrumental_path, separation, rvc_root, device, expected_duration=None):
            calls.append("separate")
            Path(vocals_path).write_bytes(Path(source_path).read_bytes())
            Path(instrumental_path).write_bytes(Path(source_path).read_bytes())
        def fake_convert(parameters, source_path, output_path, rvc_root, device, source_duration=None, validate_duration=True):
            calls.append("convert")
            Path(output_path).write_bytes(Path(source_path).read_bytes())
        with patch("dsh_bot_runtime.rvc_runner.separate_audio", side_effect=fake_separate), patch("dsh_bot_runtime.rvc_runner.convert", side_effect=fake_convert):
            from dsh_bot_runtime.rvc_runner import convert_mixed
            convert_mixed(parameters, source, output, self.root, "cpu")
        self.assertEqual(calls, ["separate", "convert"])
        self.assertAlmostEqual(validate_wav(output, expected_duration=1), 1, places=2)

    def test_runner_bounds_attention_memory_and_disables_global_cuda_graph(self):
        from dsh_bot_runtime import rvc_runner
        source = self.root / "vocals.wav"
        source.write_bytes(b"source")
        @dataclass
        class Config:
            cuda_graph: bool = True
            x_pad: int = 3
            x_query: int = 10
            x_center: int = 60
            x_max: int = 65
            @classmethod
            def create(cls, device, resource_base):
                self.assertEqual(os.environ.get("RVC_CUDA_GRAPH"), "0")
                return cls()
        class Converter:
            def __init__(self, model, config, checkpoint=None):
                self_config = config
                assert self_config.cuda_graph is False
                assert 0 < self_config.x_pad <= 1
                assert 0 < self_config.x_query < self_config.x_center < self_config.x_max <= 20
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def convert(self, *args, **kwargs):
                return SimpleNamespace(audio=b"converted", sample_rate=16000)
        modules = {"rvc.vc.audio": SimpleNamespace(write_audio=lambda *args: None),
                   "rvc.vc.config": SimpleNamespace(VoiceConversionConfig=Config),
                   "rvc.vc.engine": SimpleNamespace(VoiceConverter=Converter)}
        parameters = {"speakerId": 0, "pitchShift": 0, "indexRate": 0}
        with patch.dict(os.environ, {"RVC_CUDA_GRAPH": "1"}), patch.dict(sys.modules, modules), \
             patch("dsh_bot_runtime.rvc_runner.validate_parameters", return_value=parameters), \
             patch("dsh_bot_runtime.rvc_runner.validate_model", return_value=(self.model, {})), \
             patch("dsh_bot_runtime.rvc_runner.validate_wav", return_value=1):
            rvc_runner.convert(parameters, source, self.root / "output.wav", self.root, "cuda", source_duration=1)


if __name__ == "__main__":
    unittest.main()
