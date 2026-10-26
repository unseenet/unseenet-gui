"""#125: the GUI server keeps the files of a chosen folder, safely, for the core to publish."""
import tempfile
from pathlib import Path

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer

from unseenet_gui import server as srv


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    app = web.Application()
    app.router.add_post("/site-folder", srv.site_folder)
    async with TestClient(TestServer(app)) as c:
        yield c


def _form(files):
    f = FormData()
    for name, data in files:
        f.add_field(name, data, filename=name, content_type="application/octet-stream")
    return f


async def test_only_pages_and_pictures_inside_the_folder(client):
    r = await client.post("/site-folder", data=_form([
        ("guide/start.md", b"# Start"), ("../evil.md", b"x"), ("/etc/x.md", b"x"),
        ("run.exe", b"MZ"), ("pics/a.jpg", b"\xff\xd8"), (".siteignore", b"notes.md")]))
    out = await r.json()
    folder = Path(out["folder"])
    got = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())
    # nothing outside the folder: ".." is left out, an absolute name lands inside it
    assert "evil.md" not in " ".join(got) and not (folder.parent / "evil.md").exists()
    assert all((folder / g).resolve().is_relative_to(folder.resolve()) for g in got)
    assert set(got) >= {".siteignore", "guide/start.md", "pics/a.jpg"} and "run.exe" not in got
    assert folder.stat().st_mode & 0o777 == 0o700
    r2 = await client.post("/site-folder", data=_form([("index.md", b"# Hej")]))
    assert not folder.exists() and Path((await r2.json())["folder"]).is_dir()   # the old one gone


async def test_too_large(client, monkeypatch):
    monkeypatch.setattr(srv, "SITE_MAX", 10)
    r = await client.post("/site-folder", data=_form([("index.md", b"x" * 100)]))
    assert r.status == 400 and "too large" in (await r.json())["error"]
