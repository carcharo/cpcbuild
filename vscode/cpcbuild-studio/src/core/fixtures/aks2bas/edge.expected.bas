' edge.bas -- Arkos AKG song, converted by tools/aks2bas.py. Do not edit.
' Use: #include this at the top level, then pass @edge to MusicInit(@edge, subsong).

#ifndef __AKS_EDGE__
#define __AKS_EDGE__

asm
    jp __aks_edge_end
end asm
edge:
asm
    ; header comment
Edge_Start:
Edge_Colon:
    ld a,0x1F ; hex after a label
    db "a;b", 0xFF, 'x'    ; semicolon inside a string
    dw Edge_Colon, Edge_Other+0x10
Edge_Other:
    db 1,2
label_only_comment:
    ; just a comment

    ; indented comment
    defs 4
equ_dir:
    equ 5
    ld hl,0xabc	ld (0xC000),a
Edge_End:
__aks_edge_end:
end asm

#endif
