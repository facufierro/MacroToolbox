"""MacroToolbox operations for managed Python scripts (standard library only)."""
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_url = os.environ["MACROTOOLBOX_API_URL"]
_profile = os.environ["MACROTOOLBOX_PROFILE_ID"]
_section = os.environ.get("MACROTOOLBOX_SECTION", "scripts")
_script_owner = os.environ.get("MACROTOOLBOX_SCRIPT_OWNER", "")


def _action(kind, item_id="", value=""):
    data = json.dumps({"profile": _profile, "section": _section, "script_owner": _script_owner,
                       "kind": kind, "id": item_id, "value": str(value)}, ensure_ascii=False).encode("utf-8")
    with urlopen(Request(_url + "/runtime", data=data, headers={"Content-Type": "application/json"}), timeout=5) as response:
        response.read()


def snapshot():
    with urlopen(_url + "/runtime-state?" + urlencode({"profile": _profile}), timeout=5) as response:
        return json.load(response)


def set_state(state_id):
    _action("state", state_id, "set")


def clear_state(state_id):
    _action("state", state_id, "clear")


def toggle_state(state_id):
    _action("state", state_id, "toggle")


def start_overlay(item_id, restart=False):
    _action("overlay", item_id, "restart" if restart else "start")


def stop_overlay(item_id):
    _action("overlay", item_id, "stop")


def set_bar(item_id, value):
    _action("bar", item_id, value)


def run_behavior(steps):
    _action("behavior", value=json.dumps(steps, ensure_ascii=False))


def run_script(script_id):
    _action("script", script_id)
