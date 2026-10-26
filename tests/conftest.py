"""Shared test setup, as in unseenet's own tests."""
import pytest

from unseenet.core import ripening


@pytest.fixture(autouse=True)
def state_dir(tmp_path, monkeypatch):
    """Keys' state files go to the test's folder, never ~/.unseenet."""
    monkeypatch.setenv("UNSEENET_STATE_DIR", str(tmp_path / "keys"))


@pytest.fixture(autouse=True)
def fast_ripening():
    """Key ripening (UN-RFC 0025) with thresholds divided by 2^16 and no rules, so a
    test's new keys post at once; clients still ripen and publish ripe@."""
    ripening.scale_for_tests(16, rules=False)
    yield
    ripening.scale_for_tests(0)


async def post_menu(page, item: str):
    """Open the ⋯ menu at the head of the post shown and choose ``item`` (#post-menu)."""
    await page.locator(".reader .post-more .morebtn").click()
    await page.get_by_role("menuitem", name=item, exact=True).click()
