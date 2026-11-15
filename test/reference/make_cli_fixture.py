"""Regenerates cli.json: rawtherapee-cli 5.13 running Retinex on a 16-bit
LinearRaw DNG whose camera RGB is linear sRGB (equal white-balance
multipliers, so RawImageSource hands Retinex the image as written), with the
"sRGB" working profile and a linear Rec.709 output. The raw preprocess white
balance must be Camera: its default, Auto, scales the channels by a grey
world before Retinex sees them. The identity render (Retinex
off) comes back within about 2e-4. cli.test.ts holds rtref.ts to these.

Needs the reference rig's lib (rtrun, tiffio) from the core checkout's
.claude/cycle/ext-reference (RIG overrides it) and rawtherapee-cli.
Run: python test/reference/make_cli_fixture.py
"""
import base64
import json
import os
import struct
import sys

import numpy as np

RIG = os.environ.get("RIG", r"D:\Repositories\SafeLight\.claude\cycle\ext-reference")
sys.path.insert(0, os.path.join(RIG, "lib"))
import rtrun  # noqa: E402
import tiffio  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, ".build", "cli")
SRGB_TO_XYZ = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])

CASES = [
    ("high, radius 6, strength 80", {"Str": 80, "Neigh": 6, "highl": 2}),
    ("low, radius 12, strength 70", {"RetinexMethod": "low", "Str": 70, "Neigh": 12}),
    ("uniform, radius 8, scale 5", {"RetinexMethod": "uni", "Str": 70, "Neigh": 8, "skal": 5}),
    ("HSL logarithmic", {"Retinexcolorspace": "HSLLOG", "Str": 70, "Neigh": 6, "highl": 2}),
    ("gamma middle", {"Gammaretinex": "mid", "Str": 60, "Neigh": 6, "highl": 2}),
    ("Gaussian mask", {"mapMethod": "gaus", "Shadows": 50, "Highlights": 40, "Str": 80, "Neigh": 6, "highl": 2}),
    ("3 iterations", {"Iter": 3, "Scal": 2, "Grad": 2, "Grads": -1, "Str": 60, "Neigh": 8, "highl": 2}),
    ("median, offset", {"Median": "true", "Offs": 1500, "Str": 70, "Neigh": 6, "highl": 2}),
]


def rational(v, signed):
    d = 1000000
    return struct.pack("<ii" if signed else "<II", int(round(v * d)), d)


def write_dng(path, img16):
    h, w, _ = img16.shape
    data = img16.astype("<u2").tobytes()
    xyz_to_cam = np.linalg.inv(SRGB_TO_XYZ)
    entries = [
        (254, 4, 1, struct.pack("<I", 0)),
        (256, 4, 1, struct.pack("<I", w)),
        (257, 4, 1, struct.pack("<I", h)),
        (258, 3, 3, struct.pack("<HHH", 16, 16, 16)),
        (259, 3, 1, struct.pack("<H", 1)),
        (262, 3, 1, struct.pack("<H", 34892)),
        (271, 2, 5, b"Test\0"),
        (272, 2, 6, b"Probe\0"),
        (273, 4, 1, None),
        (277, 3, 1, struct.pack("<H", 3)),
        (278, 4, 1, struct.pack("<I", h)),
        (279, 4, 1, struct.pack("<I", len(data))),
        (284, 3, 1, struct.pack("<H", 1)),
        (50706, 1, 4, bytes([1, 4, 0, 0])),
        (50708, 2, 11, b"Test Probe\0"),
        (50714, 3, 1, struct.pack("<H", 0)),
        (50717, 3, 1, struct.pack("<H", 65535)),
        (50721, 10, 9, b"".join(rational(v, True) for v in xyz_to_cam.flatten())),
        (50728, 5, 3, b"".join(rational(1.0, False) for _ in range(3))),
        (50778, 3, 1, struct.pack("<H", 21)),
    ]
    n = len(entries)
    extra_offset = 8 + 2 + 12 * n + 4
    extra = b""
    fields = bytearray()
    strip_at = 0
    for tag, typ, count, payload in entries:
        if payload is None:
            strip_at = len(fields) + 8
            payload = struct.pack("<I", 0)
        if len(payload) <= 4:
            fields += struct.pack("<HHI", tag, typ, count) + payload.ljust(4, b"\0")
        else:
            fields += struct.pack("<HHII", tag, typ, count, extra_offset + len(extra))
            extra += payload + (b"\0" if len(payload) % 2 else b"")
    struct.pack_into("<I", fields, strip_at, extra_offset + len(extra))
    with open(path, "wb") as f:
        f.write(b"II*\0" + struct.pack("<I", 8) + struct.pack("<H", n) + bytes(fields) + struct.pack("<I", 0) + extra + data)


def scene(w, h):
    rng = np.random.default_rng(7)
    yy, xx = np.mgrid[0:h, 0:w]
    u = xx / (w - 1)
    v = yy / (h - 1)
    base = 0.03 + 0.55 * u * u + 0.12 * np.sin(7 * v) * (0.5 + u)
    img = np.stack([base * (0.8 + 0.3 * v), base, base * (1.1 - 0.4 * u)], -1)
    img[(u > 0.6) & (v > 0.45) & (v < 0.8)] = [0.5, 0.17, 0.05]
    img[(u < 0.22) & (v < 0.3)] = [0.03, 0.1, 0.33]
    img[np.hypot(xx - w * 0.3, yy - h * 0.7) < h * 0.08] = [0.85, 0.82, 0.7]
    img += 0.004 * (rng.random((h, w, 1)) - 0.5)
    return np.clip(img, 0.001, 0.95)


def f32(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode()


def main():
    os.makedirs(WORK, exist_ok=True)
    w, h = 160, 112
    img16 = np.round(scene(w, h) * 65535).astype(np.uint16)
    dng = os.path.join(WORK, "input.dng")
    write_dng(dng, img16)
    icc = os.path.join(WORK, "lin709.icc")
    rtrun.linear_icc(icc, "709")
    out_icc = os.path.abspath(icc).replace("\\", "/")
    head = [
        "[Version]", "AppVersion=5.13", "Version=351", "",
        "[Color Management]", "InputProfile=(camera)", "ToneCurve=false", "ApplyLookTable=false",
        "ApplyBaselineExposureOffset=false", "ApplyHueSatMap=false", "WorkingProfile=sRGB",
        f"OutputProfile=file:{out_icc}", "OutputProfileIntent=Relative", "OutputBPC=false", "",
        "[RAW Preprocess WB]", "Mode=0", "",
    ]
    result = {"w": w, "h": h, "input": f32(img16.astype(np.float32)), "cases": []}
    identity = None
    for name, keys in [("identity", None)] + CASES:
        lines = list(head)
        if keys is not None:
            lines += ["[Retinex]", "Enabled=true"] + [f"{k}={v}" for k, v in keys.items()] + [""]
        out = os.path.join(WORK, f"{len(result['cases'])}.tif")
        rtrun.render(dng, "\n".join(lines), out, log_path=out + ".log")
        rgb = np.asarray(tiffio.read_tiff(out), dtype=np.float64)[..., :3]
        if keys is None:
            identity = rgb
            print("identity max |d|", np.abs(rgb - img16 / 65535.0).max())
            continue
        result["cases"].append({"name": name, "keys": keys, "rgb": f32(rgb)})
        print(name, "moved", np.abs(rgb - identity).max())
    with open(os.path.join(HERE, "cli.json"), "w") as f:
        json.dump(result, f)


if __name__ == "__main__":
    main()
