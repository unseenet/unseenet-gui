"""The Update button (unseenet#264): this client's own builds, by its own version."""

import sys

import pytest

from unseenet_gui import __version__
from unseenet_gui import update as gu


class Session:
    def __init__(self, offer):
        self.offer, self.asked = offer, None

    def update_offer(self, product="unseenet", running=None):
        self.asked = (product, running)
        return self.offer


@pytest.fixture
def core_with_products(monkeypatch):
    monkeypatch.setattr(gu, "supported", lambda: True)


def test_offers_this_clients_builds_by_its_version(core_with_products, monkeypatch, tmp_path):
    import unseenet.update as up
    (tmp_path / "README-graphical.txt").write_text("")
    monkeypatch.setattr(up, "find_stick", lambda: tmp_path)
    s = Session({"version": "99.0.0", "channel": "stable"})
    info = gu.Updater().info(s)
    assert s.asked == ("unseenet-gui", __version__)
    assert info == {"version": "99.0.0", "channel": "stable", "label": "Unseenet graphical",
                    "here": True}


def test_a_folder_without_this_client_is_not_updated_from_here(core_with_products, monkeypatch,
                                                                tmp_path):
    import unseenet.update as up
    monkeypatch.setattr(up, "find_stick", lambda: tmp_path)          # the terminal client's
    info = gu.Updater().info(Session({"version": "99.0.0", "channel": "stable"}))
    assert info["here"] is False


def test_nothing_without_a_newer_build_or_with_an_older_core(monkeypatch):
    monkeypatch.setattr(gu, "supported", lambda: True)
    assert gu.Updater().info(Session(None)) is None

    class Old:
        def update_offer(self):
            return {"version": "99.0.0", "channel": "stable"}
    assert gu.Updater().info(Old()) is None
    monkeypatch.setattr(gu, "supported", lambda: False)
    assert gu.Updater().info(Session({"version": "99.0.0", "channel": "stable"})) is None


def test_update_runs_the_cores_updater(monkeypatch):
    called = []
    import unseenet.update as up
    monkeypatch.setattr(up, "main", lambda argv: called.append(argv))
    from unseenet_gui.__main__ import main
    main(["update", "--product", "gui", "--check"])
    assert called == [["--product", "gui", "--check"]]
