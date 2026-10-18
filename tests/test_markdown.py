"""Markdown and emoji (UN-RFC 0031) reach the browser as the core's safe tree."""

import unseenet.client.session as sess
from unseenet.client.session import Session
from unseenet.core.store import Store
from unseenet.core.vault import Vault
from unseenet.node.server import Node, NodeConfig

from unseenet_web import serialize

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
