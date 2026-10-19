"""Markdown and emoji (UN-RFC 0031) reach the browser as the core's safe tree."""

import unseenet.client.session as sess
from unseenet.client.session import Session
from unseenet.core.store import Store
from unseenet.core.vault import Vault
from unseenet.node.server import Node, NodeConfig

from unseenet_gui import serialize

KDF = {"ops": 1, "mem": 8192 * 1024}


async def test_posts_carry_their_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(sess, "DEFAULT_POW", 8)
    node = Node(Store(), NodeConfig(min_pow=8, forward_delay=(0, 0)))
    server = await node.serve("127.0.0.1", 0)
    s = Session(Vault.open(tmp_path / "me.vault", "pw", **KDF), status=lambda *_: None)
    s.new_identity("me", "Me"); s.add_node(f"127.0.0.1:{server.sockets[0].getsockname()[1]}")
    gid = await s.create_group("dk.md", "open", min_pow=8)
    await s.post(gid, "Fed", "**fed** :tada: ![sporing](https://evil.example/x.png)\n")
    s.set_markdown(False)
    await s.post(gid, "Ren", "*ikke fed*\n")
    await s.fetch_group(gid)
    view = serialize.group_view(s, gid)
    by = {m["subject"]: m for m in view["messages"]}
    fed = by["Fed"]
    assert fed["markdown"] is True
    inl = fed["tree"][0]["c"]
    assert inl[0]["t"] == "strong" and {"t": "emoji", "v": "🎉", "name": "tada"} in inl
    assert {"t": "text", "v": "[image: sporing]"} in inl         # never a remote image
    assert by["Ren"]["markdown"] is False and by["Ren"]["text"] == "*ikke fed*"
    assert serialize.sidebar(s, False)["markdown"] is False
    await s.close()
    server.close()


async def test_markdown_rules_reach_the_browser_without_images(tmp_path, monkeypatch):
    """Group rules in Markdown (UN-RFC 0014 2.1, unseenet #211), as the TUI shows them."""
    from unseenet.core import markup
    monkeypatch.setattr(sess, "DEFAULT_POW", 8)
    node = Node(Store(), NodeConfig(min_pow=8, forward_delay=(0, 0)))
    server = await node.serve("127.0.0.1", 0)
    s = Session(Vault.open(tmp_path / "me.vault", "pw", **KDF), status=lambda *_: None)
    s.new_identity("me", "Me"); s.add_node(f"127.0.0.1:{server.sockets[0].getsockname()[1]}")
    gid = await s.create_group("dk.regler", "open", min_pow=8)
    await s.update_group(gid, rules="# Regler\n\n- vær **søde**\n\n![x](blob:" + "a" * 32 + ")",
                         rules_type=markup.text_type_for(True, "x"))
    head = serialize.group_summary(s, gid)
    assert head["rules_markdown"] is True
    assert [b["t"] for b in head["rules_tree"]] == ["h", "ul", "p"]
    assert head["rules_tree"][2]["c"] == [{"t": "text", "v": "[image: x]"}]   # no blobs in manifests
    await s.update_group(gid, rules="*bare tekst*", rules_type=None)
    head = serialize.group_summary(s, gid)
    assert head["rules_markdown"] is False and head["rules"] == "*bare tekst*"
    await s.close()
    server.close()
