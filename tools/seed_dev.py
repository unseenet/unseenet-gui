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
MIN_POW = 12              # the node's floor (core.ripening.FLOOR_POW)
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
    # a channel open for comments (UN-RFC 0030): the others may comment, not start threads
    news = await me.create_group("dev.news", "channel", title="News from the project",
                                 min_pow=MIN_POW, kinds=["post"], comments="open", comment_days=14)
    for p in (mikkel, tove):
        for g in (talk, snak, chat, news):
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
    await me.post(news, "Version 0.4.0", "Key ripening is in: new keys work a few minutes before they post.")
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
        await who.post(chat, "", text, kind="chat")

    # feeds, a site and following people (UN-RFC 0034, 0035; gui#210): Mikkel and Tove
    # have feeds, Tove a site too, and Andreas follows both - People you follow
    mfeed = await mikkel.start_personal_group("feed")
    tfeed = await tove.start_personal_group("feed")
    tsite = await tove.start_personal_group("site")
    await tove.put_page(tsite, "index", "# Toves noder\n\nNoter om at køre en node på en Pi 5 - "
                        "og hvorfor jeg gør det.\n")
    long = await mikkel.post(mfeed, "Første tur med noden i rygsækken",
                             "Jeg har haft en node kørende fra en Pi i rygsækken hele weekenden.\n\n"
                             "...\n\n"            # read more (UN-RFC 0031 3.2.1): the feed cuts here
                             "Den holdt fint på et powerbank i 14 timer, og Tor fandt vej hver gang "
                             "jeg skiftede net. Næste gang prøver jeg med solcelle.")
    await tove.post(tfeed, "", "Ny side om at køre en node på en Pi 5 - link i min profil :rocket:",
                    kind="chat")
    for who, name, f in ((mikkel, "Mikkel", mfeed), (tove, "Tove", tfeed)):
        await who.publish_profile({"v": 1, "about": f"Hej, jeg er {name}.", "feeds": [f]})
    await me.follow_person(mikkel.identity().key_text)
    await me.follow_person(tove.identity().key_text)
    me.subscribe(tsite)
    await tove.fetch_group(mfeed)
    await tove.post(mfeed, "", "Solcelle! Det vil jeg se.", kind="chat", references=[long])
    me.set_in_timeline(snak, True)         # a discussion group in the timeline (UN-RFC 0034 6.2)

    # private: contacts, a private post and chats with unread lines (gui#209)
    me.add_contact(mikkel.identity().key_text, "Mikkel")
    me.add_contact(tove.identity().key_text, "Tove")
    await mikkel.send_chat("contact:" + me.identity().key_text, "Har du set mit feed? Rygsæk-noden kører.")
    await tove.send_chat("contact:" + me.identity().key_text, "Kan vi peere node4 med din i aften?")
    await tove.send_chat("contact:" + me.identity().key_text, "Jeg har sendt dig onion-adressen som post.")
    await tove.send_private(me.my_inbox, "Onion-adressen til node4",
                            "Her er den - del den ikke videre endnu.\n",
                            owner_key=me.identity().public_key)

    for p in (mikkel, tove):           # pick up the invitation
        p.subscribe(ops)
        await p.fetch_group(ops)
    await tove.post(ops, "", "node4 is back after the reboot.", kind="chat")
    await mikkel.post(ops, "", "Catch-up by pull took about 40 s for all groups.", kind="chat")
    for p in people:
        await p.close()
    print("seeded", talk, chat, ops)


asyncio.run(main())
