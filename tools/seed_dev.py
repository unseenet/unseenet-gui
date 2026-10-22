"""Seed a local dev node with a few people, groups, threads and a chat."""
import asyncio
import os
import sys
from pathlib import Path

import unseenet.client.session as sess
from unseenet.client.session import Session
from unseenet.core.vault import Vault

NODE = "127.0.0.1:1119"
BASE = Path(sys.argv[1])
FAST = {"ops": 1, "mem": 8192 * 1024}
# The playground node does not ask for key ripening (min_ripe "-", UN-RFC 0025), so a
# new key pays the unripe surcharge, +6 bits: at the network default of 20 every post
# here would cost 26 bits. The groups ask for little, as the node does.
MIN_POW = 8
sess.DEFAULT_POW = MIN_POW        # also for inboxes and anything without a manifest yet


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

    talk = await me.create_group("unseenet", "open", title="The project: protocol, software, ideas, questions",
                                 min_pow=MIN_POW)
    snak = await me.create_group("dk.snak", "open", title="Snak om alt og intet", min_pow=MIN_POW)
    chat = await me.create_group("dk.snak.chat", "open", title="Hurtig snak", view="chat", low_latency=True,
                                 min_pow=MIN_POW)
    ops = await me.create_group("operators", "closed", title="People who run nodes", view="chat",
                                min_pow=MIN_POW)
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
    r2 = await tove.post(talk, "Re: Forwarding delay: how long is long enough?",
                         "Andreas wrote:\n"
                         "> Honest answer: not much with four nodes. It starts to matter once\n"
                         "> each node has more peers.\n\n"
                         "Then how about letting the delay grow with how few peers a node has?\n"
                         "A node with two peers waits longer than one with twenty.",
                         references=[root, r1])
    await mikkel.fetch_group(talk)
    await mikkel.post(talk, "Re: Forwarding delay: how long is long enough?",
                      "Tove wrote:\n"
                      "> A node with two peers waits longer than one with twenty.\n\n"
                      "I like that. It costs nothing on a busy network, and hides the most\n"
                      "where it is needed. Worth a UN-RFC?",
                      references=[root, r1, r2])
    await tove.post(talk, "Proof-of-work feels slow on old laptops",
                    "On my 2012 ThinkPad a post takes a while. Could the client show progress?")
    await me.post(snak, "Hej fra Kvistgård", "Første indlæg i dk.snak. Velkommen!")
    bh = await mikkel.post(snak, "Bornhack - hvem tager med?",
                           "Jeg tænker at køre en node fra teltet. Nogen der vil peere?")
    await tove.fetch_group(snak)
    await tove.post(snak, "Re: Bornhack - hvem tager med?",
                    "Jeg er med! Jeg tager en Pi og et powerbank.", references=[bh])
    await me.fetch_group(snak)
    await me.post(snak, "Re: Bornhack - hvem tager med?",
                  "Fedt. Lad os lave en lukket gruppe til os der kører noder.", references=[bh])
    await tove.post(talk, "Node on a Pi 5: notes",
                    "Runs fine from an LXC too. Peering only needs the other node's onion address.")

    for text, who in [("Er der nogen her?", mikkel), ("Ja da! Webklienten virker.", tove),
                      ("Fedt - jeg tester chat nu.", mikkel), ("Den ser godt ud i mørkt tema.", tove),
                      ("Og den kører fra en USB-stick.", mikkel)]:
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
