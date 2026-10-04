REM MODELS: plus
REM Conformance: cpcplus soft scroll and split screen on a CPC Plus (Phase 7 P3): SSCR
REM (&6804), SSSL (&6801) and SSA (&6802/&6803) read back through the library's
REM PlusPeek (Caprice32 and CPCEC both keep them readable; what they do to the picture
REM is checked by tests/screens/plus_splitscroll.bas): ScrollFine's clamping, the
REM border bit kept apart from the scroll, SplitScreen's conversion of a byte address
REM to the CRTC's R12/R13 form, SplitScreenCrtc's raw form, SplitOff, and that none of
REM them disturbs the CRTC start address or the interrupt state. No PlusPageIn: the
REM library pages from the private block.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

FUNCTION Reg(a AS UINTEGER) AS STRING
  RETURN STR$(PlusPeek(a))
END FUNCTION

CHK("avail", STR$(PlusAvailable()), "1")
CHK("reset_sscr", Reg($6804), "0")
CHK("reset_sssl", Reg($6801), "0")

REM ---- soft scroll: bits 3-0 horizontal 0-15, bits 6-4 vertical 0-7, bit 7 border
ScrollFine(5, 3)
CHK("scroll_5_3", Reg($6804), STR$(5 + 3 * 16))
ScrollFine(15, 7)
CHK("scroll_max", Reg($6804), STR$(15 + 7 * 16))
ScrollFine(16, 8)
CHK("scroll_clamped", Reg($6804), STR$(15 + 7 * 16))
ScrollFine(255, 255)
CHK("scroll_clamped_hi", Reg($6804), STR$(15 + 7 * 16))
ScrollBorder(1)
CHK("border_on_keeps_scroll", Reg($6804), STR$(128 + 15 + 7 * 16))
ScrollFine(2, 1)
CHK("scroll_keeps_border", Reg($6804), STR$(128 + 2 + 16))
ScrollBorder(0)
CHK("border_off_keeps_scroll", Reg($6804), STR$(2 + 16))
ScrollBorder(7)
CHK("border_nonzero_is_on", Reg($6804), STR$(128 + 2 + 16))
ScrollFine(0, 0)
ScrollBorder(0)
CHK("scroll_off", Reg($6804), "0")

REM ---- split screen: address as a byte address (page bits 5-4 of R12, word offset
REM in R12 bits 1-0 and R13), line in SSSL
SplitScreen(96, $C000)
CHK("split_c000", Reg($6801) + " " + Reg($6802) + " " + Reg($6803), "96 48 0")
SplitScreen(104, $4000 + 160)
CHK("split_4000_160", Reg($6801) + " " + Reg($6802) + " " + Reg($6803), "104 16 80")
SplitScreen(8, $87FE)
CHK("split_87fe", Reg($6801) + " " + Reg($6802) + " " + Reg($6803), "8 35 255")
SplitScreen(8, $8000 + 513)
CHK("split_odd_address_drops_bit0", Reg($6802) + " " + Reg($6803), "33 0")
SplitScreen(255, $0000)
CHK("split_0000", Reg($6801) + " " + Reg($6802) + " " + Reg($6803), "255 0 0")
SplitScreenCrtc(50, $3123)
CHK("split_crtc", Reg($6801) + " " + Reg($6802) + " " + Reg($6803), "50 49 35")
SplitScreenCrtc(60, $FF12)
CHK("split_crtc_masks_r12", Reg($6802) + " " + Reg($6803), "63 18")
SplitOff()
CHK("split_off", Reg($6801), "0")
SplitScreen(0, $C000)
CHK("split_line0_is_off", Reg($6801), "0")
SplitScreen(40, $C000)
SplitScreen(0, $4000)
CHK("split_line0_keeps_address", Reg($6801) + " " + Reg($6802), "0 48")

REM ---- no side effects elsewhere
CHK("pri_untouched", Reg($6800), "0")
CHK("iff_on", STR$(Iff()), "1")
CHK("ivr_untouched", Reg($6805), STR$(PlusPeek($6805)))
ScrollFine(0, 0)
SplitOff()
PRINT "DONE"
END
