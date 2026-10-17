' pl_pens.bas -- Lamplighter Plus's 16 playfield pens in 12-bit colours, written
' by make_plus_art.py. Do not edit. Two bytes a pen as the ASIC's palette RAM
' wants them (SetPalette12Block(@pl_pens(0), 0, 16)); pens 11-14 are the lit
' lamps' flame, rotated over FLAME_PEN0.. by palette cycling.

CONST FLAME_PEN0 AS UBYTE = 11
DIM pl_flame(3) AS UINTEGER => { _
    $FA0, $FE4, $F50, $FFB _
}

DIM pl_pens(31) AS UBYTE => { _
    $00, $00, $08, $00, $80, $00, $F0, $00, $F0, $08, $F0, $0F, $80, $08, $FF, $0F, _
    $88, $08, $0F, $08, $0F, $0F, $F0, $0A, $F4, $0E, $F0, $05, $FB, $0F, $0F, $00 _
}
