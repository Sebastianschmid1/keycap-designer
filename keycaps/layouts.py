"""Layout-Daten: 3 Sprachen x 4 Formfaktoren (KLE-Standardgeometrie, Positionen in u)."""
from typing import NamedTuple, Optional

U = 19.05
LANGS = ("de", "en", "us")
FORMS = ("full", "tkl", "75", "60")


class Key(NamedTuple):
    id: str
    x: float            # linke obere Ecke in u (y nach unten); bei 'iso' der untere 1,25u-Teil
    y: float
    w: float
    h: float
    shape: str          # 'rect' | 'iso'
    spec: Optional[tuple]   # (main, shift, altgr) oder None (blank)

    @property
    def rects(self):
        """Belegte Rechtecke (x, y, w, h) in u – für die Überlappungsprüfung."""
        if self.shape == "iso":
            return [(self.x - 0.25, self.y, 1.5, 1.0), (self.x, self.y + 1, 1.25, 1.0)]
        return [(self.x, self.y, self.w, self.h)]

    @property
    def stem_mm(self):
        """Stem-Mitte in mm (CAD: y nach oben)."""
        if self.shape == "iso":
            return (self.x + 0.625) * U, -(self.y + 1) * U
        return (self.x + self.w / 2) * U, -(self.y + self.h / 2) * U


# ------------------------------------------------------------------ Legends
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Symboltasten: id -> (base, shift, altgr)
_SYM = {
    "us": {
        "Backquote": ("`", "~", ""), "Digit1": ("1", "!", ""), "Digit2": ("2", "@", ""), "Digit3": ("3", "#", ""),
        "Digit4": ("4", "$", ""), "Digit5": ("5", "%", ""), "Digit6": ("6", "^", ""), "Digit7": ("7", "&", ""),
        "Digit8": ("8", "*", ""), "Digit9": ("9", "(", ""), "Digit0": ("0", ")", ""), "Minus": ("-", "_", ""),
        "Equal": ("=", "+", ""), "BracketLeft": ("[", "{", ""), "BracketRight": ("]", "}", ""),
        "Backslash": ("\\", "|", ""), "Semicolon": (";", ":", ""), "Quote": ("'", '"', ""),
        "Comma": (",", "<", ""), "Period": (".", ">", ""), "Slash": ("/", "?", ""),
    },
}
_SYM["en"] = dict(_SYM["us"], **{
    "Backquote": ("`", "¬", ""), "Digit2": ("2", '"', ""), "Digit3": ("3", "£", ""), "Quote": ("'", "@", ""),
    "IntlHash": ("#", "~", ""), "IntlBackslash": ("\\", "|", ""),
})
_SYM["de"] = {
    "Backquote": ("^", "°", ""), "Digit1": ("1", "!", ""), "Digit2": ("2", '"', "²"), "Digit3": ("3", "§", "³"),
    "Digit4": ("4", "$", ""), "Digit5": ("5", "%", ""), "Digit6": ("6", "&", ""), "Digit7": ("7", "/", "{"),
    "Digit8": ("8", "(", "["), "Digit9": ("9", ")", "]"), "Digit0": ("0", "=", "}"), "Minus": ("ß", "?", "\\"),
    "Equal": ("´", "`", ""), "BracketRight": ("+", "*", "~"), "IntlHash": ("#", "'", ""),
    "IntlBackslash": ("<", ">", "|"), "Comma": (",", ";", ""), "Period": (".", ":", ""), "Slash": ("-", "_", ""),
}
_DE_LETTERS = {"BracketLeft": "Ü", "Semicolon": "Ö", "Quote": "Ä", "KeyY": "Z", "KeyZ": "Y"}
_DE_ALTGR = {"KeyQ": "@", "KeyE": "€", "KeyM": "µ"}

_NAMES_EN = {
    "Esc": "Esc", "Tab": "Tab", "Caps": "Caps Lock", "Shift": "Shift", "Ctrl": "Ctrl", "Win": "Win", "Alt": "Alt",
    "AltGr": "Alt Gr", "Menu": "Menu", "Enter": "Enter", "Backspace": "Backspace", "PrtSc": "PrtSc",
    "ScrLk": "ScrLk", "Pause": "Pause", "Ins": "Ins", "Home": "Home", "PgUp": "PgUp", "Del": "Del", "End": "End",
    "PgDn": "PgDn", "Num": "Num", "Fn": "Fn",
}
_NAMES = {
    "en": _NAMES_EN,
    "us": dict(_NAMES_EN, AltGr="Alt"),
    "de": dict(_NAMES_EN, Tab="↹", Caps="⇪", Shift="⇧", Ctrl="Strg", Menu="Menü", Enter="↵", Backspace="←",
               PrtSc="Druck", ScrLk="Rollen", Ins="Einfg", Home="Pos1", PgUp="Bild↑", Del="Entf", End="Ende",
               PgDn="Bild↓", Num="Num"),
}
_ARROWS = {"ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→"}


def _spec(lang, kid, name=None):
    """Legend-Spezifikation einer Taste; name = Schlüssel in _NAMES für Funktionstasten."""
    if name:
        return (_NAMES[lang][name], "", "")
    if kid in _ARROWS:
        return (_ARROWS[kid], "", "")
    if kid.startswith("Numpad") or kid == "NumLock":
        txt = {"NumLock": _NAMES[lang]["Num"], "NumpadDivide": "/", "NumpadMultiply": "*", "NumpadSubtract": "-",
               "NumpadAdd": "+", "NumpadEnter": _NAMES[lang]["Enter"],
               "NumpadDecimal": "," if lang == "de" else "."}.get(kid, kid[-1])
        return (txt, "", "")
    if kid.startswith("F") and kid[1:].isdigit():
        return (kid, "", "")
    if kid.startswith("Key"):
        letter = _DE_LETTERS.get(kid, kid[3:]) if lang == "de" else kid[3:]
        return (letter, "", _DE_ALTGR.get(kid, "") if lang == "de" else "")
    if lang == "de" and kid in _DE_LETTERS:
        return (_DE_LETTERS[kid], "", "")
    base, shift, altgr = _SYM[lang][kid]
    return (base, shift, altgr)


# ------------------------------------------------------------------ Layout
def _main_rows(iso, compact_bottom):
    """Hauptblock: 5 Reihen als [(id, name|None, w)], ISO-Enter separat (id 'EnterIso')."""
    r1 = [("Backquote", None, 1)] + [(f"Digit{d}", None, 1) for d in "1234567890"] + \
         [("Minus", None, 1), ("Equal", None, 1), ("Backspace", "Backspace", 2)]
    r2 = [("Tab", "Tab", 1.5)] + [(f"Key{c}", None, 1) for c in "QWERTYUIOP"] + \
         [("BracketLeft", None, 1), ("BracketRight", None, 1)]
    r3 = [("CapsLock", "Caps", 1.75)] + [(f"Key{c}", None, 1) for c in "ASDFGHJKL"] + \
         [("Semicolon", None, 1), ("Quote", None, 1)]
    r4 = [("ShiftLeft", "Shift", 2.25 if not iso else 1.25)]
    if iso:
        r4.append(("IntlBackslash", None, 1))
    r4 += [(f"Key{c}", None, 1) for c in "ZXCVBNM"] + [("Comma", None, 1), ("Period", None, 1), ("Slash", None, 1)]
    r4.append(("ShiftRight", "Shift", 2.75 if not compact_bottom else 1.75))
    if iso:
        r3.append(("IntlHash", None, 1))
        r3.append(("EnterIso", "Enter", 1.25))
    else:
        r2.append(("Backslash", None, 1.5))
        r3.append(("Enter", "Enter", 2.25))
    r5 = [("ControlLeft", "Ctrl", 1.25), ("MetaLeft", "Win", 1.25), ("AltLeft", "Alt", 1.25), ("Space", None, 6.25)]
    if compact_bottom:
        r5 += [("AltRight", "AltGr", 1), ("Fn", "Fn", 1), ("ControlRight", "Ctrl", 1)]
    else:
        r5 += [("AltRight", "AltGr", 1.25), ("MetaRight", "Win", 1.25), ("ContextMenu", "Menu", 1.25),
               ("ControlRight", "Ctrl", 1.25)]
    return [r1, r2, r3, r4, r5]


def layout(lang, form):
    assert lang in LANGS and form in FORMS, (lang, form)
    iso = lang != "us"
    keys = []

    def add(kid, name, x, y, w=1.0, h=1.0, shape="rect", blank=False):
        spec = None if blank else _spec(lang, kid, name)
        keys.append(Key(kid, x, y, float(w), float(h), shape, spec))

    def row(items, x, y):
        for kid, name, w in items:
            if kid == "EnterIso":
                add("Enter", "Enter", x, y - 1, 1.25, 2, "iso")   # beginnt in der Q-Reihe, x = linker Rand des 1,25u-Teils
                x += 1.25
                continue
            add(kid, name, x, y, w, blank=(kid == "Space"))
            x += w

    compact = form == "75"
    rows = _main_rows(iso, compact)
    if form in ("full", "tkl"):
        add("Escape", "Esc", 0, 0)
        for i in range(12):
            add(f"F{i + 1}", None, 2 + i + 0.5 * (i // 4), 0)
        for j, (kid, nm) in enumerate((("PrintScreen", "PrtSc"), ("ScrollLock", "ScrLk"), ("Pause", "Pause"))):
            add(kid, nm, 15.25 + j, 0)
        y0 = 1.5
    elif form == "75":
        add("Escape", "Esc", 0, 0)
        for i in range(12):
            add(f"F{i + 1}", None, 1 + i, 0)
        add("PrintScreen", "PrtSc", 13, 0)
        add("Pause", "Pause", 14, 0)
        add("Delete", "Del", 15, 0)
        y0 = 1
    else:
        y0 = 0
    for i, r in enumerate(rows):
        row(r, 0, y0 + i)

    if form in ("full", "tkl"):
        for j, (kid, nm) in enumerate((("Insert", "Ins"), ("Home", "Home"), ("PageUp", "PgUp"))):
            add(kid, nm, 15.25 + j, y0)
        for j, (kid, nm) in enumerate((("Delete", "Del"), ("End", "End"), ("PageDown", "PgDn"))):
            add(kid, nm, 15.25 + j, y0 + 1)
        add("ArrowUp", None, 16.25, y0 + 3)
        for j, kid in enumerate(("ArrowLeft", "ArrowDown", "ArrowRight")):
            add(kid, None, 15.25 + j, y0 + 4)
    elif form == "75":
        add("Home", "Home", 15, 1)
        add("PageUp", "PgUp", 15, 2)
        add("PageDown", "PgDn", 15, 3)
        add("ArrowUp", None, 14, 4)
        add("End", "End", 15, 4)
        for j, kid in enumerate(("ArrowLeft", "ArrowDown", "ArrowRight")):
            add(kid, None, 13 + j, 5)
    if form == "full":
        nx = 18.5
        add("NumLock", "Num", nx, y0)
        add("NumpadDivide", None, nx + 1, y0)
        add("NumpadMultiply", None, nx + 2, y0)
        add("NumpadSubtract", None, nx + 3, y0)
        for r, digits in enumerate(("789", "456", "123")):
            for c, d in enumerate(digits):
                add(f"Numpad{d}", None, nx + c, y0 + 1 + r)
        add("NumpadAdd", None, nx + 3, y0 + 1, 1, 2)
        add("NumpadEnter", None, nx + 3, y0 + 3, 1, 2)
        add("Numpad0", None, nx, y0 + 4, 2, 1)
        add("NumpadDecimal", None, nx + 2, y0 + 4)
    return keys
