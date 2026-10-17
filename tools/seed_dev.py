"""Seed a local dev node with a few people, groups, threads and a chat."""
import asyncio
import os
import sys
from pathlib import Path

from unseenet.client.session import Session
from unseenet.core.vault import Vault

NODE = "127.0.0.1:1119"
BASE = Path(sys.argv[1])
FAST = {"ops": 1, "mem": 8192 * 1024}


def session(name: str, display: str) -> Session:
    v = Vault.open(BASE / f"{name}.vault", "test", **FAST)
    s = Session(v, status=lambda *_: None)
    if not s.has_identity():
        s.new_identity(name, display)
    if not s.nodes:
        s.add_node(NODE)
    s.data["starter_groups"] = True
    s.save()
    return s


async def main() -> None:
    me = session("andreas", "Andreas")
    mikkel = session("mikkel", "Mikkel")
    tove = session("tove", "Tove")
    people = [me, mikkel, tove]
    for p in people:
        await p.ensure_inbox()

    talk = await me.create_group("unseenet", "open", title="The project: protocol, software, ideas, questions")
    snak = await me.create_group("dk.snak", "open", title="Snak om alt og intet")
    chat = await me.create_group("dk.snak.chat", "open", title="Hurtig snak", view="chat", low_latency=True)
    ops = await me.create_group("operators", "closed", title="People who run nodes", view="chat")
    for p in (mikkel, tove):
        for g in (talk, snak, chat):
            p.subscribe(g)
        await p.list_groups()
    for p in (mikkel, tove):
        await me.invite(ops, p.identity().key_text)

    root = await mikkel.post(talk, "Forwarding delay: how long is long enough?",
                             "Nodes wait a random time before passing a post on.\n\n"
                             "With four nodes I can almost guess the entry node by watching which one has the post first.")
    r1 = await me.post(talk, "Re: Forwarding delay: how long is long enough?",
                       "Honest answer: not much with four nodes. It starts to matter once each node has more peers.",
                       references=[root])
    await tove.fetch_group(talk)
    await tove.post(talk, "Re: Forwarding delay: how long is long enough?",
                    "How about letting the delay grow with how few peers a node has?", references=[root, r1])
    await tove.post(talk, "Proof-of-work feels slow on old laptops",
                    "On my 2012 ThinkPad a post takes a while. Could the client show progress?")
    await me.post(snak, "Hej fra Kvistgård", "Første indlæg i dk.snak. Velkommen!")

    for text, who in [("Er der nogen her?", mikkel), ("Ja da! Webklienten virker.", tove),
                      ("Fedt - jeg tester chat nu.", mikkel)]:
        await who.post(chat, "chat", text)

    for p in (mikkel, tove):           # pick up the invitation
        p.subscribe(ops)
        await p.fetch_group(ops)
    await tove.post(ops, "chat", "node4 is back after the reboot.")
    await mikkel.post(ops, "chat", "Catch-up by pull took about 40 s for all groups.")
    for p in people:
        await p.close()
    print("seeded", talk, chat, ops)


asyncio.run(main())
