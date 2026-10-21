"""Messages and groups come from the core's dict form (#28, unseenet #139)."""

import pytest

import unseenet.client.session as sess
from unseenet.client.session import Message

from unseenet_gui import serialize

from test_core_threads import _setup


async def test_the_page_gets_the_cores_message_fields(tmp_path, monkeypatch):
    server, s, rt, _ = await _setup(tmp_path, monkeypatch)
    gid = await s.create_group("dk.snak", "open", min_pow=8)
    await s.post(gid, "Hej", "Tekst\n-- \nMe\n")
    await s.fetch_group(gid)
    m = next(iter(s.cache[gid].values()))
    core = m.to_dict()
    page = serialize.group_view(s, gid)["messages"][0]
    for name in ("id", "number", "group", "subject", "date", "text", "signature",
                 "references", "kind", "encrypted", "private", "readable", "error"):
        assert page[name] == core[name], name
    assert page["text"] == "Tekst" and page["signature"] == "Me"
    await s.close()
    server.close()


async def test_groups_come_from_group_info(tmp_path, monkeypatch):
    server, s, rt, _ = await _setup(tmp_path, monkeypatch)
    gid = await s.create_group("dk.chat", "open", min_pow=8, view="chat", low_latency=True,
                               title="Snak")
    await s.post(gid, "", "hej\n", kind="chat")
    await s.fetch_group(gid)
    s.data["read"] = {}
    head = serialize.group_summary(s, gid)
    info = s.group_info(gid).to_dict()
    assert (head["title"], head["view"], head["fast"], head["owner"]) == ("Snak", "chat", True, True)
    assert head["unread"] == info["unread"] == 1 and head["kinds"] == info["kinds"]
    side = serialize.sidebar(s, True)
    listed = [g["id"] for h in side["hierarchies"] for g in h["groups"]]
    assert gid in listed
    await s.close()
    server.close()


def test_a_core_with_another_dict_shape_fails_loudly(monkeypatch):
    monkeypatch.setattr(serialize, "DICT_VERSION", sess.DICT_VERSION + 1)
    with pytest.raises(RuntimeError, match="version"):
        serialize.core_dict(Message(number=1, message_id="<1@x>", group="dk.x@aaaaaaaaaaaaaaaa"))
