import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch


class ScriptApiTests(unittest.TestCase):
    def setUp(self):
        module_path = Path(__file__).parents[1] / "src-tauri/src/script_api.py"
        spec = importlib.util.spec_from_file_location("macrotoolbox_api_test", module_path)
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"MACROTOOLBOX_API_URL": "http://127.0.0.1:17823", "MACROTOOLBOX_PROFILE_ID": "profile", "MACROTOOLBOX_SECTION": "scripts", "MACROTOOLBOX_SCRIPT_OWNER": ""}):
            spec.loader.exec_module(self.api)

    def test_behavior_requests_preserve_unicode_and_nested_actions(self):
        steps = [{"type": "parallel", "steps": [{"type": "send", "text": "a; ø😀\n"}]}]
        with patch.object(self.api, "urlopen") as send:
            self.api.run_behavior(steps)
        request = send.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["profile"], "profile")
        self.assertEqual(json.loads(payload["value"]), steps)
        self.assertEqual(request.get_method(), "POST")

    def test_state_and_overlay_commands_use_the_same_managed_context(self):
        with patch.object(self.api, "_action") as operation:
            self.api.set_state("buff")
            self.api.clear_state("buff")
            self.api.start_overlay("timer", restart=True)
            self.api.set_bar("health", 42)
        self.assertEqual([call.args for call in operation.call_args_list], [
            ("state", "buff", "set"), ("state", "buff", "clear"),
            ("overlay", "timer", "restart"), ("bar", "health", 42),
        ])

    def test_operation_errors_propagate_to_the_script(self):
        with patch.object(self.api, "urlopen", side_effect=OSError("backend unavailable")):
            with self.assertRaises(OSError):
                self.api.toggle_state("buff")

    def test_behavior_requests_keep_the_calling_section_and_script_owner(self):
        with patch.object(self.api, "_section", "events"), patch.object(self.api, "_script_owner", "library"), patch.object(self.api, "urlopen") as send:
            self.api.run_behavior([{"type": "hold", "key": "a"}])
        payload = json.loads(send.call_args.args[0].data)
        self.assertEqual(payload["profile"], "profile")
        self.assertEqual(payload["section"], "events")
        self.assertEqual(payload["script_owner"], "library")


if __name__ == "__main__":
    unittest.main()
