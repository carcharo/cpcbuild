# Phase 4d design: own interrupt handler and AY primitive

Status: built (cpc-port-notes.md §15, §16).

Decisions (notes.md, 2026-10-02): the handler is **always on**; `AY_WRITE`
drives the **PPI directly** inside DI/EI.

## 1. What the firmware handler does (verified in the ROMs)

RAM &0038 holds `JP &B941` (6128) or `JP &B939` (464). The handler is the
same code on both models (6128 ROM &03E7, 464 ROM &03CA, copied to RAM):

    di
    ex af,af'
    jr c, nested        ; AF' carry set = interrupt inside an interrupt
    exx
    ld a,c
    scf
    ei                  ; nested interrupts allowed for one instruction
    ex af,af'           ; ... alternate carry is now set
    di
    push af
    res 2,c
    out (c),c           ; lower ROM on, via BC' (B' = &7F, C' = config)
    call ...            ; ticker, keyboard scan, frame-fly events
    or a
    ex af,af'           ; AF' carry clear again
    ... restore C' ROM config ...
    exx
    pop af
    ei
    ret

So it needs BC' = the firmware's value and AF' carry clear on entry,
keeps the main registers, and **leaves with `ei; ret`**.

## 2. The handler (`runtime/isr.asm`, forced into every build)

Installed by the bootstrap after FW_BC is captured: the original jump
target is read from RAM &0039 (works on every model) into a patched
`jp`, then `jp CPC_ISR` is written at &0038. The RAM vector is only seen
while the lower ROM is off, i.e. while our code (or firmware code
running from RAM) executes; with the lower ROM on, the ROM's own &0038
goes straight to the firmware.

    CPC_ISR:
        push af
        ld   a, (IN_FW)
        or   a
        jr   nz, direct          ; inside a firmware call: firmware regs live
        inc  a
        ld   (IN_FW), a          ; an interrupt during the chain goes direct
        push bc / de / hl / ix / iy
        ex   af,af' ; push af    ; program's AF'
        exx ; push bc / de / hl  ; program's BC' DE' HL'
        ld   bc, (FW_BC)
        exx
        ex   af,af' ; or a ; ex af,af'   ; AF' carry clear
        call ORIG                ; returns with interrupts ON
        di
        exx ; ld (FW_BC),bc ; pop hl / de / bc ; exx
        pop  af ; ex af,af'
        pop  iy / ix / hl / de / bc
        xor  a
        ld   (IN_FW), a
        pop  af
        ei
        ret
    direct:
        pop  af
    ORIG:
        jp   $FFFF               ; patched at boot

Why IN_FW stays set during the chain: the firmware handler's final
`ei; ret` lets an interrupt in before our `di`. At that point BC' is still
the firmware's and AF' carry is clear, so the direct path is correct.
IX/IY are saved because firmware event routines may use them.
Cost: about 250 T-states over the firmware's own handler, 300 times a
second (about 2 % of the CPU). Measured afterwards: with the firmware's
own handler the total is **12.3 %** (notes.md question 21).

## 3. The firmware gate (`fwcall.asm`)

Today: interrupts off except during the call. New version:
- `di` on entry (an interrupt between `IN_FW = 1` and loading BC' would
  otherwise take the direct path with the program's BC');
- `ei` before the call (unchanged), `di` after it (unchanged);
- `ei` before the final `ret` (new): the gate always returns with
  interrupts on.

## 4. Prologue, END and errors

- Prologue keeps `di`; the bootstrap ends with `ei` once the vector is in
  place, so the other `#init` routines run with interrupts on.
- `__CPC_END` and `__ERROR` do `di` before `rst 0`; the RAM reset entry
  turns the lower ROM on and restarts the firmware, which rebuilds &0038.

## 5. Code that must now run under DI

Anything that touches the PPI or Gate Array directly, because the
firmware handler uses both (keyboard scan at 50 Hz through PPI/AY reg 14;
Gate Array ROM config every interrupt, inks at flyback when flashing):
- `cpcbuild/keys.asm` ScanKeys (PPI/AY matrix scan);
- `cpcbuild/palette.asm` `__CB_GA_SET` (pen select + colour is two OUTs);
- `cpcbuild/display.asm` anything that writes CRTC/GA directly (check);
- the new `AY_WRITE`.
Built with plain `di ... ei` (not a saved IFF: `ld a,i` misreports the
state on NMOS Z80s if an interrupt arrives during it); compiled code
always runs with interrupts on, so they return with interrupts on.
Reading PPI port B (VSYNC) needs no DI.

Nothing else in the runtime uses DI/EI/HALT (checked: only stub.asm and
fwcall.asm). (Correction, §16: this search missed `inc sp`/`dec sp` and
the zx48k files cpc falls back to; zx48k's `swap32.asm` was a live case,
now overridden.) One file uses SP as a data pointer: `cpcbuild/fill.asm`
`__CB_CLEAR` (ClearScreen fills with PUSH). An interrupt there would push
into screen memory, so it must fill in short DI chunks (DI, a few dozen
PUSHes, restore SP, EI) or drop the PUSH trick; a single DI over the whole
16 KB would hold interrupts off for about a frame and a half.

## 6. Tests

- Conformance `isr.bas`: KL_TIME_PLEASE advances during a pure compute
  loop with no firmware calls (proves interrupts run in compiled code);
  results of an exx-heavy workload (SUBs with parameters, 32-bit and
  float arithmetic, fixed point) match a reference after N iterations
  while interrupts run.
- Stress `isr_stress.bas`: the same workload plus firmware calls (PRINT,
  KM_TEST_KEY) plus an asm frame-fly event (KL_NEW_FRAME_FLY) counting
  frames, running for minutes; checks the frame count matches elapsed
  time and nothing crashes. Run on the 6128 and the 464.
- Whole conformance suite on both models; the speed INFO numbers will
  include the ~2 % interrupt load.

## 7. AY primitive and Play library

- `runtime/ay.asm` `AY_WRITE` (A = register, C = value): DI-safe PPI
  sequence: port A (&F4) = register, port C (&F6) = &C0 (select), &00
  (inactive), port A = value, port C = &80 (write), &00. Keep the PPI's
  port A as output (the keyboard scan sets it to input and back).
- `stdlib/play.bas`: copy of zx48k's, with `_PLAY_WRITE_TO_REGISTER`
  calling AY_WRITE, the note-divider table regenerated for the CPC's
  1 MHz AY clock, `CpuCyclesPerSecond` = 4000000 with the tempo
  calibrated in the emulator (wait states).
- Document: programs using Play/music must not use BEEP/SOUND (firmware
  sound manager) and should call SOUND_RESET (&BCA7) once at start.

## 8. Later (Phase 5b)

Firmware events calling BASIC code (`OnFrame(@sub)` via KL_NEW_FRAME_FLY):
a trampoline that saves the alternate bank and IX, runs the routine and
restores them. Not needed for 4d.
