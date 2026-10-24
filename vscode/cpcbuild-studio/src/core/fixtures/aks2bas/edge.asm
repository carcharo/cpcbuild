; header comment
Edge_Start
Edge_Colon:  ld a,#1F   ; hex after a label
	db "a;b", #FF, 'x'   ; semicolon inside a string
	dw Edge_Colon, Edge_Other+#10
Edge_Other: db 1,2
label_only_comment:  ; just a comment

	; indented comment
    defs 4
equ_dir equ 5
	ld hl,#abc	ld (#C000),a
Edge_End
