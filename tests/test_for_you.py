"""unseenet #170: replies and mentions are sent to the page apart."""

from unseenet.client.session import ForYouCount

from unseenet_gui import serialize


class FakeSession:
    def for_you_counts(self, gid=None):
        return ForYouCount(1, 2) if gid else ForYouCount(3, 4)


def test_for_you_apart():
    assert serialize.for_you(FakeSession(), "dk.snak@x") == {"for_you": 3, "replies": 1, "mentions": 2}
    assert serialize.for_you(FakeSession()) == {"for_you": 7, "replies": 3, "mentions": 4}
