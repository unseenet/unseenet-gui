from unseenet_gui.serialize import group_tree_dict


def g(label, gid=None):
    return {"id": gid or label + "@f", "label": label}


def test_tree_for_the_sidebar():
    t = group_tree_dict("alt", [g("alt.history.egypt"), g("alt.history.denmark"), g("alt.news.wikipedia")])
    assert t["path"] == "alt" and t["groups"] == []
    hist, news = t["children"]
    assert (hist["label"], [c["label"] for c in hist["children"]]) == ("history", ["denmark", "egypt"])
    assert (news["label"], news["groups"], news["children"]) == ("news.wikipedia", ["alt.news.wikipedia@f"], [])


def test_fingerprinted_label_is_named_by_its_name():
    t = group_tree_dict("alt", [g("alt.x@ab12", "alt.x@ab12ff"), g("alt.y")])
    assert [c["label"] for c in t["children"]] == ["x", "y"]
