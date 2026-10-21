"""The core's typed events reach the page in this client's names (#29, unseenet #139)."""

from unseenet.client import events as ev

from test_core_threads import _setup, _until


async def test_postage_progress_belongs_to_the_job_being_sent(tmp_path, monkeypatch):
    server, s, rt, events = await _setup(tmp_path, monkeypatch)
    s.on(rt._on_core_event)
    gid = await s.create_group("dk.chat", "open", min_pow=8, view="chat")
    events.clear()
    job = rt.post(gid, "", "hej", [], chat=True)
    assert await _until(lambda: any(k == "post" and kw.get("state") == "reached" for k, kw in events))
    kinds = [(k, kw.get("job"), kw.get("state")) for k, kw in events]
    pow_events = [kw for k, kw in events if k == "pow"]
    assert pow_events and all(p["job"] == job for p in pow_events)
    assert pow_events[-1]["done"] and pow_events[-1]["fraction"] == 1.0
    assert kinds.index(("pow", job, None)) < kinds.index(("post", job, "sent"))   # before "sent"
    assert rt._sending is None                                          # nothing is tagged after
    await s.close()
    server.close()


def test_core_events_are_passed_on_by_name(tmp_path):
    from unseenet_gui.runtime import Runtime
    rt = Runtime(tmp_path / "v.vault")
    got = []
    rt.emit = lambda kind, **kw: got.append((kind, kw))
    rt._on_core_event(ev.GroupUpdated("dk.x@aaaaaaaaaaaaaaaa", 2))
    rt._on_core_event(ev.GroupsChanged())
    rt._on_core_event(ev.NodeState("x.onion:119", False, "refused"))
    rt._on_core_event(ev.TorState(45, "Loading relay descriptors"))
    rt._on_core_event(ev.Ripening("ed25519:x", 512, None, 1024))
    rt._on_core_event(ev.PowProgress(10, 100))                      # no job being sent: dropped
    assert [k for k, _ in got] == ["group", "groups", "groups", "node", "tor", "ripening", "groups"]
    assert got[0][1] == {"id": "dk.x@aaaaaaaaaaaaaaaa"}
    assert got[3][1] == {"address": "x.onion:119", "up": False, "error": "refused"}
    assert got[5][1] == {"level": None, "next_at": 1024, "t": 512}
