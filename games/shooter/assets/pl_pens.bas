' pl_pens.bas -- Starfall Plus's 16 playfield pens in 12-bit colours, written by
' make_plus_art.py. Do not edit. Two bytes a pen as the ASIC's palette RAM wants
' them (SetPalette12Block(@pl_pens(0), 0, 16)).

CONST PL_BORDER AS UINTEGER = $002
' sprite colour entries (1-15) the stage-2 raster handlers rewrite per row
CONST PL_BODY AS UBYTE = 11
CONST PL_LIGHT AS UBYTE = 10
CONST PL_BODY_N AS UINTEGER = $F34

DIM pl_pens(31) AS UBYTE => { _
    $00, $00, $FF, $0F, $0F, $0D, $3F, $07, $F0, $00, $F0, $08, $F0, $0F, $FF, $00, _
    $F8, $08, $00, $0F, $00, $08, $80, $08, $07, $02, $6F, $09, $80, $00, $88, $08 _
}
