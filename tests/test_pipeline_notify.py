import json
from pathlib import Path

from PIL import Image

from pipeline import notify
from pipeline.config import PipelineConfig


def test_send_photos_builds_media_group(tmp_path, monkeypatch):
    p1, p2 = tmp_path / "main.png", tmp_path / "slide1.png"
    Image.new("RGB", (10, 10)).save(p1)
    Image.new("RGB", (10, 10)).save(p2)
    posted = []

    def fake_post(cfg, method, payload, content_type):
        posted.append((method, payload, content_type))
        return True

    monkeypatch.setattr(notify, "_post", fake_post)
    cfg = PipelineConfig(repo_dir=tmp_path, bot_token="t", admin_ids=[1, 2])
    assert notify.send_photos(cfg, [p1, p2, tmp_path / "missing.png"], caption="Шапка")
    assert len(posted) == 2 and posted[0][0] == "sendMediaGroup"
    body, ctype = posted[0][1], posted[0][2]
    assert ctype.startswith("multipart/form-data; boundary=")
    assert b'name="photo0"; filename="main.png"' in body
    assert b'name="photo1"; filename="slide1.png"' in body
    media_start = body.index(b'name="media"')
    media_json = body[media_start:].split(b"\r\n\r\n", 1)[1].split(b"\r\n--", 1)[0]
    media = json.loads(media_json)
    assert media[0]["caption"] == "Шапка" and media[0]["media"] == "attach://photo0"
    assert "caption" not in media[1]


def test_send_disabled_without_token(tmp_path):
    cfg = PipelineConfig(repo_dir=tmp_path)
    assert notify.send(cfg, "x") is False
    assert notify.send_photos(cfg, [Path("nope.png")]) is False
