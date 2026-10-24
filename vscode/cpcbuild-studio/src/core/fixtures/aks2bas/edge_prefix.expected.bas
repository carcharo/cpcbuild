' edge.bas -- Arkos sound effects (AKX), converted by tools/aks2bas.py. Do not edit.
' Use: #include this at the top level, then pass @edge to SfxInit(@edge).

#ifndef __AKS_EDGE__
#define __AKS_EDGE__

asm
    jp __aks_edge_end
end asm
edge:
asm
    ; header comment
p_Edge_Start:
p_Edge_Colon:
    ld a,0x1F ; hex after a label
    db "a;b", 0xFF, 'x'    ; semicolon inside a string
    dw p_Edge_Colon, p_Edge_Other+0x10
p_Edge_Other:
    db 1,2
p_label_only_comment:
    ; just a comment

    ; indented comment
    defs 4
p_equ_dir:
    equ 5
    ld hl,0xabc	ld (0xC000),a
p_Edge_End:
__aks_edge_end:
end asm

#endif
