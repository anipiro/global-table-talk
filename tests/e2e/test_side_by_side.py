"""Two people side by side, overlapping dialogue: every utterance must stay with the person who said it.

Run with: python3 -m unittest discover -s tests/e2e -p 'test_*.py'.

Drives the real server-side arbitration (insert_line) through the backend API using the labeled
samples in src/lib/speakerSamples.json (the same ones the /test/speakers report uses), in a
throwaway table per sample, and also checks manual reassignment + undo.
"""

import json
import os
import random
import string
import unittest
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]


def env():
    vals = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"')
    return vals["VITE_SUPABASE_URL"].rstrip("/"), vals["VITE_SUPABASE_PUBLISHABLE_KEY"]


URL, KEY = env()
H = {"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=representation"}
SAMPLES = json.loads((ROOT / "src/lib/speakerSamples.json").read_text())


def rest(method, path, **kw):
    r = requests.request(method, f"{URL}/rest/v1/{path}", headers=H, timeout=20, **kw)
    if r.status_code >= 400:
        raise AssertionError(f"{method} {path}: {r.status_code} {r.text}")
    return r.json() if r.text else None


def rpc(name, **args):
    return rest("POST", f"rpc/{name}", json=args)


class Table:
    def __init__(self, voice_level=None):
        self.voice_level = voice_level

    def __enter__(self):
        code = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
        self.room = rest("POST", "rooms", json={"code": code, "status": "ended"})[0]["id"]
        lv = self.voice_level or SAMPLES["voice_level"]
        ms = rest("POST", "members", json=[
            {"room_id": self.room, "name": "Side A", "language": "ka", "approved": True, "voice_level": lv["A"]},
            {"room_id": self.room, "name": "Side B", "language": "ka", "approved": True, "voice_level": lv["B"]},
        ])
        self.phone = {m["name"][-1]: m["id"] for m in ms}
        return self

    def say(self, phone, text, loudness):
        return rpc("insert_line", p_room_id=self.room, p_speaker_id=self.phone[phone], p_text=text, p_language="ka", p_loudness=loudness)

    def lines(self):
        return rest("GET", f"lines?room_id=eq.{self.room}&select=id,speaker_id,text,ambiguous")

    def __exit__(self, *exc):
        rest("DELETE", f"speaker_corrections?room_id=eq.{self.room}")
        rest("DELETE", f"lines?room_id=eq.{self.room}")
        rest("DELETE", f"members?room_id=eq.{self.room}")
        rest("DELETE", f"rooms?id=eq.{self.room}")


class SideBySideTest(unittest.TestCase):
    def test_overlapping_dialogue_stays_with_the_right_speaker(self):
        for s in SAMPLES["samples"]:
            with self.subTest(sample=s["id"]), Table(s.get("voice_level")) as t:
                utt_of = {}
                for e in s["events"]:
                    lid = t.say(e["phone"], e["text"], e["loudness"])
                    if lid:
                        utt_of[lid] = str(e["utt"])
                who = {v: k for k, v in t.phone.items()}
                kept = t.lines()
                for utt, truth in s["truth"].items():
                    mine = [l for l in kept if utt_of.get(l["id"]) == utt]
                    self.assertEqual([who[l["speaker_id"]] for l in mine], [truth], f"{s['label']}: utterance {utt}")
                    if utt in s.get("ambiguous", []):
                        self.assertTrue(mine[0]["ambiguous"], f"{s['label']}: near-tie should be flagged unsure")
                    else:
                        self.assertFalse(mine[0]["ambiguous"], f"{s['label']}: clear case should not be flagged")

    def test_reassign_moves_nearby_unsure_lines_and_undo_restores_them(self):
        with Table() as t:
            t.say("A", "ხელფასი გადმოვიდა", 0.06)
            t.say("B", "ხელფასი გადმოვიდა", 0.058)  # near-tie → A kept, flagged
            t.say("A", "ღვინო ძალიან კარგია", 0.05)
            t.say("B", "ღვინო ძალიან კარგი", 0.049)  # second near-tie a moment later → also A, flagged
            flagged = [l for l in t.lines() if l["ambiguous"]]
            self.assertEqual(len(flagged), 2)
            cid = rpc("reassign_line", p_line_id=flagged[0]["id"], p_speaker_id=t.phone["B"])
            moved = {l["id"]: l for l in t.lines()}
            for f in flagged:  # the correction carries over to the nearby unsure line too
                self.assertEqual(moved[f["id"]]["speaker_id"], t.phone["B"])
                self.assertFalse(moved[f["id"]]["ambiguous"])
            self.assertEqual(rpc("undo_speaker_correction", p_correction_id=cid), 2)
            back = {l["id"]: l for l in t.lines()}
            for f in flagged:
                self.assertEqual(back[f["id"]]["speaker_id"], t.phone["A"])
                self.assertTrue(back[f["id"]]["ambiguous"])

if __name__ == "__main__":
    unittest.main()
