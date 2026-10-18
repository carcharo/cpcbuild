#!/usr/bin/env python3
"""reach.py -- is Lamplighter's tower completable?  A Python model of game.bas's
movement (MovePlayer, MoveX, MoveY, ClimbStep, Ground, Touch) over the rooms of
assets/rooms.bas (generated from tower.tmx), searched exhaustively.

The search itself ignores enemies (they only cost a life: the player
respawns) and forbids spikes (a step that touches them is not a move). Lamps
are touched, never "lit" in the model; a room's doors count as open once all
its lamps are reached.

Enemies are covered by a static check instead (enemy_check): the whole area
each enemy can sweep (MoveEnemies ported: a walker's platform span, a
floater's vertical range, a bat's horizontal range plus its sine wobble) must
not overlap a door cell, the two cells next to an exit (the doorway's two
columns inward, or a ladder's two end cells) or the room's start cell. So the
first room can always be left without timing a pass through an enemy.

  reach.py             check: every lamp reachable, every exit usable in the
                       intended order, the tower completable; exit 1 if not
  reach.py --inputs F  also write the winning input sequence as a BASIC include
                       (run-length encoded: input, count pairs) to F
  reach.py --check     as the plain check, and fail if tests/playseq.bas (the
                       sequence tests/playthrough.bas plays) is not the one
                       the model finds now (after changing the map or the
                       movement: reach.py --inputs tests/playseq.bas)
  (make reach-lamp runs --check; it takes about a minute)

The inputs are the bits of platform_cpc.bas: 1 left, 2 right, 4 fire, 16 up,
32 down. tests/playthrough.bas plays the sequence on the real game.bas.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOMS_BAS = HERE.parent / "assets" / "rooms.bas"

RW, RH = 20, 23
L, R, F, U, D = 1, 2, 4, 16, 32
JTAB = [-5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 1, 1, 2, 2, 3, 3, 4]
# attribute bits per tile number (TA_TAB in game.bas)
TA = [0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0]
T_LAMP, T_DOOR = 5, 7
ORDER = [9, 10, 11, 8, 7, 6, 3, 4, 5, 2, 1, 0]       # the intended climb
INPUTS = sorted(set(a | b | c for a in (0, L, R) for b in (0, F) for c in (0, U, D)))


def load():
    txt = ROOMS_BAS.read_text()
    m = re.search(r"DIM rooms\(\d+\) AS UBYTE => \{(.*?)\}", txt, re.S)
    vals = [int(v, 16) for v in re.findall(r"\$([0-9A-Fa-f]{2})", m.group(1))]
    assert len(vals) == 12 * RW * RH
    rooms = [vals[i * RW * RH:(i + 1) * RW * RH] for i in range(12)]
    m = re.search(r"DIM robj\(\d+\) AS UBYTE => \{(.*?)\}", txt, re.S)
    robj = [int(v, 16) for v in re.findall(r"\$([0-9A-Fa-f]{2})", m.group(1))]
    m = re.search(r"DIM roff\(\d+\) AS UINTEGER => \{(.*?)\}", txt, re.S)
    roff = [int(v) for v in re.findall(r"\d+", m.group(1))]
    start = {}
    for r in range(12):
        o = roff[r]
        while robj[o] != 0:
            if robj[o] == 1:
                start[r] = (robj[o + 1] << 3, robj[o + 2] << 3)
            o += 5
    return rooms, start


ROOMS, START = load()
LAMPS = {r: [(i % RW, i // RW) for i, t in enumerate(ROOMS[r]) if t == T_LAMP] for r in range(12)}


class World:
    """The attribute grids; doors[r] True = room r's doors open."""

    def __init__(self, doors):
        self.doors = doors
        self.cache = {}

    def grid(self, r):
        g = self.cache.get(r)
        if g is None:
            g = []
            for t in ROOMS[r]:
                if t == T_DOOR and self.doors[r]:
                    t = 8
                g.append(TA[t & 15])
            self.cache[r] = g
        return g


class Bad(Exception):
    pass


def step(w, s, inp):
    """One GameStep. s = (room, x, y, air, jt, climb). Returns the new state,
    or None for a death. Touched lamps are returned too: (state, lamps)."""
    room, x, y, air, jt, climb = s
    st = [room, x, y, air, jt, climb]   # pRoom pX pY pAir pJt pClimb
    g = w.grid(room)

    def ta(c, row):
        if not (0 <= c < RW and 0 <= row < RH):
            raise Bad(f"tile read outside the room: room {st[0]} cell {c},{row}")
        return w.grid(st[0])[row * RW + c]

    def enter(nr, nx, ny):
        st[0], st[1], st[2] = nr, nx, ny

    def col_solid(c, yy):
        return (ta(c, yy >> 3) & 1) or (ta(c, (yy + 8) >> 3) & 1) or (ta(c, (yy + 15) >> 3) & 1)

    def row_attr(yy):
        rr = yy >> 3
        return ta((st[1] + 1) >> 3, rr) | ta((st[1] + 6) >> 3, rr)

    def ground():
        if st[2] >= 168:
            return 0 if st[0] < 9 else 1
        if ((st[2] + 16) & 7) != 0:
            return 0
        return 1 if (row_attr(st[2] + 16) & 3) else 0

    def move_x(d):
        if d == 1:
            if st[1] < 2:
                if st[0] % 3 > 0:
                    enter(st[0] - 1, 152, st[2])
                return
            nx = st[1] - 2
            if col_solid((nx + 1) >> 3, st[2]):
                return
        else:
            if st[1] >= 152:
                if st[0] % 3 < 2:
                    enter(st[0] + 1, 0, st[2])
                return
            nx = st[1] + 2
            if col_solid((nx + 6) >> 3, st[2]):
                return
        st[1] = nx

    def move_y():
        dy = JTAB[st[4]]
        if st[4] < 16:
            st[4] += 1
        if dy < 0:
            ny = st[2] + dy
            if ny < 0:
                if st[0] >= 3:
                    enter(st[0] - 3, st[1], 168)
                else:
                    st[2] = 0
                    st[4] = 10
                return
            a = row_attr(ny)
            if a & 1:
                st[2] = ((ny >> 3) + 1) << 3
                st[4] = 10
            else:
                st[2] = ny
        elif dy > 0:
            nb = st[2] + dy + 15
            if nb >= 184:
                if st[0] < 9:
                    enter(st[0] + 3, st[1], 0)
                else:
                    st[2] = 168
                    st[3] = 0
                    st[4] = 0
                return
            a = row_attr(nb)
            row = nb >> 3
            if (a & 1) or ((a & 2) and ((st[2] + 15) >> 3) < row):
                st[2] = (row << 3) - 16
                st[3] = 0
                st[4] = 0
            else:
                st[2] += dy

    def climb_step():
        cx = (st[1] + 4) >> 3
        if inp & F:
            st[5] = 0
            st[3] = 1
            st[4] = 0
            return
        if inp & U:
            if st[2] < 2:
                if st[0] >= 3:
                    enter(st[0] - 3, st[1], 168)
                return
            ny = st[2] - 2
            st[2] = ny
            if ((ta(cx, (ny + 8) >> 3) | ta(cx, (ny + 15) >> 3)) & 4) == 0:
                st[5] = 0
                st[3] = 1
                st[4] = 10
        elif inp & D:
            ny = st[2] + 2
            if ny + 16 > 184:
                if st[0] < 9:
                    enter(st[0] + 3, st[1], 0)
                return
            a = ta(cx, (ny + 15) >> 3)
            if (a & 1) or ((a & 2) and (a & 4) == 0):
                st[2] = (((ny + 15) >> 3) << 3) - 16
                st[5] = 0
                return
            st[2] = ny
            if ((ta(cx, (ny + 8) >> 3) | ta(cx, (ny + 15) >> 3)) & 4) == 0:
                st[5] = 0
                st[3] = 1
                st[4] = 10

    def start_climb(cx):
        st[5] = 1
        st[3] = 0
        st[4] = 0
        st[1] = cx << 3

    def move_player():
        if st[5]:
            climb_step()
            return
        cx = (st[1] + 4) >> 3
        if inp & U:
            if (ta(cx, (st[2] + 8) >> 3) | ta(cx, (st[2] + 15) >> 3)) & 4:
                start_climb(cx)
                return
        if (inp & D) and st[3] == 0 and st[2] < 168:
            if ta(cx, (st[2] + 16) >> 3) & 4:
                start_climb(cx)
                return
        if inp & L:
            move_x(1)
        elif inp & R:
            move_x(0)
        if st[3] == 0:
            if inp & F:
                st[3] = 1
                st[4] = 0
            elif ground() == 0:
                st[3] = 1
                st[4] = 10
        if st[3]:
            move_y()

    move_player()
    # Touch
    l = (st[1] + 1) >> 3
    r = (st[1] + 6) >> 3
    lamps = []
    for k in range(3):
        row = (st[2] + (0, 8, 15)[k]) >> 3
        for c in range(l, r + 1):
            t = ta(c, row)
            if t & 16:
                lamps.append((st[0], c, row))
            if k > 0 and (t & 8):
                return None, []
    return tuple(st), lamps


def search(w, src, stop_rooms=None):
    """BFS over states from src, any room reachable. Returns parent map
    {state: (prev, input)}. stop_rooms: states in other rooms are leaves."""
    par = {src: None}
    q = deque([src])
    while q:
        s = q.popleft()
        if stop_rooms is not None and s[0] not in stop_rooms and s != src:
            continue
        for inp in INPUTS:
            n, _ = step(w, s, inp)
            if n is None or n in par:
                continue
            par[n] = (s, inp)
            q.append(n)
    return par


def path_to(par, s):
    out = []
    while par[s] is not None:
        s, i = par[s]
        out.append(i)
    return out[::-1]


def lamps_of_state_set(w, states):
    seen = {}
    for s in states:
        # the lamps the player at state s overlaps
        l = (s[1] + 1) >> 3
        r = (s[1] + 6) >> 3
        g = w.grid(s[0])
        for k in range(3):
            row = (s[2] + (0, 8, 15)[k]) >> 3
            for c in range(l, r + 1):
                if g[row * RW + c] & 16:
                    seen[(s[0], c, row)] = s
    return seen


def analyse(verbose=True):
    """Phase search: rooms in ORDER; returns (ok, inputs, log)."""
    log = []
    ok = True
    doors = [False] * 12
    w = World(doors)
    first = START[ORDER[0]]
    state = (ORDER[0], first[0], first[1], 0, 0, 0)
    seq = []
    for idx, room in enumerate(ORDER):
        want = {room}
        # closed doors in this room; earlier rooms are open (not entered here)
        par = search(w, state, stop_rooms=want)
        inroom = [s for s in par if s[0] == room]
        seen = lamps_of_state_set(w, inroom)
        miss = [l for l in LAMPS[room] if (room, l[0], l[1]) not in seen]
        if miss:
            ok = False
            log.append(f"room {room}: lamps NOT reachable (doors closed): {miss}")
        # walk to every lamp, nearest first, from the current state
        cur = state
        todo = [(room, c, r) for c, r in LAMPS[room] if (room, c, r) in seen]
        walked = []
        while todo:
            par = search(w, cur, stop_rooms=want)
            best = None
            for s in par:           # breadth first: the first hit is the nearest
                if s[0] != room:
                    continue
                ls = lamps_of_state_set(w, [s])
                hit = [lamp for lamp in ls if lamp in todo]
                if hit:
                    best = (path_to(par, s), s, hit[0])
                    break
            if best is None:
                ok = False
                log.append(f"room {room}: lost the way to {todo}")
                break
            p, s, lamp = best
            seq += p
            # lamps lit on the way: every lamp touched by any state on the path
            walked.append((lamp, len(p)))
            t = cur
            for i in p:
                t2, ls = step(w, t, i)
                for lm in ls:
                    if lm in todo:
                        todo.remove(lm)
                t = t2
            if lamp in todo:
                todo.remove(lamp)
            cur = s
        log.append(f"room {room} ({len(LAMPS[room])} lamps): {sum(n for _, n in walked)} steps to light them")
        # doors open now (all lamps touched)
        doors[room] = True
        w.cache.clear()
        if idx + 1 == len(ORDER):
            break
        nxt = ORDER[idx + 1]
        par = search(w, cur, stop_rooms=want)
        goal = [s for s in par if s[0] == nxt]
        if not goal:
            ok = False
            log.append(f"room {room}: no way to room {nxt} even with the doors open")
            break
        goal.sort(key=lambda s: len(path_to(par, s)))
        g0 = goal[0]
        p = path_to(par, g0)
        # which door-closed config blocks the exit?  (informational)
        w2 = World([False if i == room else doors[i] for i in range(12)])
        par2 = search(w2, cur, stop_rooms=want)
        gated = not any(s[0] == nxt for s in par2)
        log.append(f"  exit to room {nxt}: {len(p)} steps; {'gated by the door' if gated else 'NOT gated (open way)'}")
        seq += p
        state = g0
    if ok:
        # replay the whole sequence on a fresh model and count the lamps
        doors2 = [False] * 12
        w3 = World(doors2)
        t = (ORDER[0], START[ORDER[0]][0], START[ORDER[0]][1], 0, 0, 0)
        lit = set()
        for i in seq:
            t2, ls = step(w3, t, i)
            if t2 is None:
                ok = False
                log.append("replay: died")
                break
            lit.update(ls)
            r = t2[0]
            if all((r, c, rr) in lit for c, rr in LAMPS[r]):
                if not doors2[r]:
                    doors2[r] = True
                    w3.cache.clear()
            t = t2
        total = sum(len(v) for v in LAMPS.values())
        log.append(f"replay: {len(seq)} steps, {len(lit)} of {total} lamps lit, ends in room {t[0]}")
        if len(lit) != total or t[0] != 0:
            ok = False
    return ok, seq, log


# ---- enemies (static) ---------------------------------------------------

BATTAB = [8, 10, 11, 12, 14, 15, 15, 16, 16, 16, 15, 15, 14, 12, 11, 10,
          8, 6, 5, 4, 2, 1, 1, 0, 0, 0, 1, 1, 2, 4, 5, 6]


def load_enemies():
    txt = ROOMS_BAS.read_text()
    m = re.search(r"DIM robj\(\d+\) AS UBYTE => \{(.*?)\}", txt, re.S)
    robj = [int(v, 16) for v in re.findall(r"\$([0-9A-Fa-f]{2})", m.group(1))]
    m = re.search(r"DIM roff\(\d+\) AS UINTEGER => \{(.*?)\}", txt, re.S)
    roff = [int(v) for v in re.findall(r"\d+", m.group(1))]
    en = {}
    for r in range(12):
        o = roff[r]
        en[r] = []
        while robj[o] != 0:
            if robj[o] == 2:
                en[r].append((robj[o + 1], robj[o + 2] * 8, robj[o + 3] * 8, robj[o + 4] * 8))
            o += 5
    return en


def envelope(room, kind, x0, y0, rng, doors_open):
    """Pixel boxes (x0, y0, x1, y1), x1/y1 exclusive, the 8 x 16 sprite sweeps
    (MoveEnemies in game.bas, every position it can reach from its start)."""
    if kind == 2:                               # floater: y0 .. y0 + range
        return (x0, y0, x0 + 8, y0 + rng + 16)
    if kind == 3:                               # bat: x0 .. x0 + range, y0 - 8 .. y0 + 8
        lo = min(BATTAB) - 8
        hi = max(BATTAB) - 8
        return (x0, y0 + lo, x0 + rng + 8, y0 + hi + 16)
    g = World([doors_open] * 12).grid(room)     # walker: WalkOK, turning at walls/gaps

    def ta(c, row):
        return g[row * RW + c]

    def walk_ok(x, y, d):
        c = (x + 7) >> 3 if d == 1 else x >> 3
        if any(ta(c, (y + k) >> 3) & 1 for k in (0, 8, 15)):
            return False
        if ta(c, (y + 15) >> 3) & 8:
            return False
        return bool(ta(c, (y + 16) >> 3) & 3)

    x, d = x0, 1
    xs, seen = {x}, set()
    while (x, d) not in seen:
        seen.add((x, d))
        if d == 1:
            if x >= 152:
                d = 0
            else:
                if walk_ok(x + 2, y0, 1):
                    x += 2
                else:
                    d = 0
        else:
            if x < 2:
                d = 1
            elif walk_ok(x - 2, y0, 0):
                x -= 2
            else:
                d = 1
        xs.add(x)
    return (min(xs), y0, max(xs) + 8, y0 + 16)


def sensitive_cells(room):
    """name -> (col, row) cells an enemy must stay clear of."""
    t = ROOMS[room]
    cells = {}
    for i, v in enumerate(t):
        if v == T_DOOR:
            cells[(i % RW, i // RW)] = "door"
    for side, doorway, inward in (("left", 0, (1, 2)), ("right", RW - 1, (RW - 2, RW - 3))):
        if t[20 * RW + doorway] != 1:                       # not brick: an exit this side
            for row in (20, 21):
                for c in (doorway,) + inward:
                    cells.setdefault((c, row), f"{side} exit")
    for c in range(RW):
        if t[c] in (3, 12):                                 # ladder through the ceiling
            for row in (0, 1):
                cells.setdefault((c, row), "ceiling ladder")
        if t[(RH - 1) * RW + c] in (3, 12):                 # ladder top in the floor
            for row in (RH - 2, RH - 1):
                cells.setdefault((c, row), "floor ladder")
    sx, sy = START[room]
    for row in (sy // 8, sy // 8 + 1):
        cells.setdefault((sx // 8, row), "start")
    return cells


def enemy_check():
    """The static enemy check; returns (ok, log lines)."""
    log, ok = [], True
    for room, ens in load_enemies().items():
        cells = sensitive_cells(room)
        for kind, x0, y0, rng in ens:
            name = {1: "walker", 2: "floater", 3: "bat"}[kind]
            hits = set()
            for doors_open in (False, True):
                bx0, by0, bx1, by1 = envelope(room, kind, x0, y0, rng, doors_open)
                for (c, row), what in cells.items():
                    if bx0 < c * 8 + 8 and c * 8 < bx1 and by0 < row * 8 + 8 and row * 8 < by1:
                        hits.add((what, c, row))
            if hits:
                ok = False
                log.append(f"room {room}: {name} at ({x0 // 8},{y0 // 8}) sweeps "
                           + ", ".join(f"{w} cell {c},{r}" for w, c, r in sorted(hits)))
    if ok:
        log.append("enemies: no patrol touches a door, an exit approach or a start cell")
    return ok, log


def rle(seq):
    out = []
    for i in seq:
        if out and out[-1][0] == i and out[-1][1] < 255:
            out[-1][1] += 1
        else:
            out.append([i, 1])
    return out


def write_include(path, seq):
    pairs = rle(seq)
    flat = [v for p in pairs for v in p]
    lines = []
    for i in range(0, len(flat), 16):
        lines.append("    " + ", ".join(str(v) for v in flat[i:i + 16]) + (", _" if i + 16 < len(flat) else " _"))
    path.write_text("' Generated by tests/reach.py: a winning input sequence (input, count pairs).\n"
                    f"CONST PLAY_PAIRS AS UINTEGER = {len(pairs)}\n"
                    f"DIM playSeq({len(flat) - 1}) AS UBYTE => {{ _\n" + "\n".join(lines) + "\n}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", type=Path)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    ok, seq, log = analyse()
    eok, elog = enemy_check()
    ok = ok and eok
    log += elog
    print("\n".join(log))
    if args.check and ok:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp) / "playseq.bas"
            write_include(t, seq)
            if t.read_text() != (HERE / "playseq.bas").read_text():
                print("tests/playseq.bas is out of date: reach.py --inputs tests/playseq.bas")
                ok = False
    if args.inputs and ok:
        write_include(args.inputs, seq)
        print(f"wrote {args.inputs}")
    print("REACH OK" if ok else "REACH FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
