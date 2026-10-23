-- cpcbuild_core.lua -- the CPCBuild Aseprite extension without any dialogs:
-- create CPC sprites and tilesets, check them against the import tools'
-- rules, and export them for tools/img2cpc.py and tools/tmx2bas.py.
-- MIT licensed, like the rest of cpcbuild (see LICENSE).
--
-- The dialogs live in cpcbuild.lua; tools/aseprite/headless.lua calls these
-- functions straight from `aseprite -b --script`, which is how the tests
-- run them. Written for Aseprite 1.3 (the API of 1.3-beta20 and later: no
-- sprite.properties and no json library there, so the settings live in
-- sprite.data and the JSON is written by hand).
--
-- Conventions
--   * One pixel in the sprite is one CPC pixel. Mode 0 art is drawn with a
--     2:1 pixel ratio, mode 1 with 1:1, mode 2 with 1:2 (looks right on
--     screen; the PNG is not stretched).
--   * The sprite palette is the mode's pens, in pen order.
--   * Masked sprites keep palette index 0 for "transparent", so pen p is
--     palette index p + 1. All other sprites and all tilesets have pen p =
--     palette index p, and a fresh canvas is filled with pen 0.
--   * Settings are kept in sprite.data as one line:
--       cpcbuild:1;kind=sprite;mode=0;name=hero;fw=16;fh=16;masked=0
--       cpcbuild:1;kind=tiles;mode=0;name=ground;tw=4

local cpc = {}

cpc.PPB = { [0] = 2, [1] = 4, [2] = 8 }        -- pixels per screen byte
cpc.PENS = { [0] = 16, [1] = 4, [2] = 2 }      -- pens per mode
cpc.MAX_COLS = 8                               -- widest sheet (see sheet_cols)
cpc.MAX_TILES = 256                            -- TileMap takes one byte per cell
cpc.TILE_H = 8

-- Default pens: the firmware's own inks (as in the fork's bareboot.asm). Pens
-- 14 and 15 flash by default (1/24 and 16/11); either colour would repeat
-- another pen, and img2cpc gives a repeated colour to the lower pen, so here
-- they are two unused colours, 11 and 15. Programs set them with SetPalette.
cpc.DEFAULT_PENS = {
  [0] = { 1, 24, 20, 6, 26, 0, 2, 8, 10, 12, 14, 16, 18, 22, 11, 15 },
  [1] = { 1, 24, 20, 6 },
  [2] = { 1, 24 },
}

-- ---------------------------------------------------------------- colours

-- Firmware colour n = 9*G + 3*R + B, each of R, G, B 0..2 for 0x00/0x80/0xFF
-- (the same table as img2cpc.py's fw_rgb).
local LEVEL = { [0] = 0x00, [1] = 0x80, [2] = 0xFF }

function cpc.fw_rgb(n)
  return LEVEL[(n // 3) % 3], LEVEL[n // 9], LEVEL[n % 3]
end

local FW = {}
for n = 0, 26 do FW[n] = { cpc.fw_rgb(n) } end

-- Nearest firmware colour (squared RGB distance, ties to the lower number,
-- as img2cpc.py does).
function cpc.nearest_fw(r, g, b)
  local best, bestd = 0, nil
  for n = 0, 26 do
    local c = FW[n]
    local d = (r - c[1]) ^ 2 + (g - c[2]) ^ 2 + (b - c[3]) ^ 2
    if bestd == nil or d < bestd then best, bestd = n, d end
  end
  return best
end

function cpc.is_firmware(r, g, b)
  local function ok(v) return v == 0x00 or v == 0x80 or v == 0xFF end
  return ok(r) and ok(g) and ok(b)
end

-- ---------------------------------------------------------------- rules

-- Legal tile widths in pixels for a mode: PPB * 1, 2 or 4 (1, 2 or 4 bytes).
function cpc.tile_widths(mode)
  local p = cpc.PPB[mode]
  return { p, p * 2, p * 4 }
end

function cpc.is_tile_width(mode, tw)
  for _, w in ipairs(cpc.tile_widths(mode)) do
    if w == tw then return true end
  end
  return false
end

-- Pixel ratio for a mode: mode 0 pixels are twice as wide as high, mode 2
-- twice as high as wide.
function cpc.pixel_ratio(mode)
  if mode == 0 then return Size(2, 1) end
  if mode == 2 then return Size(1, 2) end
  return Size(1, 1)
end

-- Sheet columns for n cells: the largest divisor of n that is at most
-- MAX_COLS, so every cell of the sheet is a real frame or tile (img2cpc.py
-- cuts the whole sheet and would otherwise see blank extra frames). A prime
-- above MAX_COLS gives a single row.
function cpc.sheet_cols(n)
  if n <= cpc.MAX_COLS then return n end
  for c = cpc.MAX_COLS, 2, -1 do
    if n % c == 0 then return c end
  end
  return n
end

-- ---------------------------------------------------------------- settings

function cpc.encode_meta(m)
  local s = "cpcbuild:1;kind=" .. m.kind .. ";mode=" .. m.mode .. ";name=" .. m.name
  if m.kind == "sprite" then
    s = s .. ";fw=" .. m.fw .. ";fh=" .. m.fh .. ";masked=" .. (m.masked and 1 or 0)
  else
    s = s .. ";tw=" .. m.tw
  end
  return s
end

-- The settings stored in the sprite, or nil if it was not made by CPCBuild.
function cpc.get_meta(sprite)
  local d = sprite.data
  if d == nil or d:sub(1, 10) ~= "cpcbuild:1" then return nil end
  local kv = {}
  for k, v in d:gmatch(";(%w+)=([^;]*)") do kv[k] = v end
  if not kv.kind or not kv.mode then return nil end
  local m = { kind = kv.kind, mode = tonumber(kv.mode), name = kv.name or "" }
  if m.kind == "sprite" then
    m.fw, m.fh = tonumber(kv.fw), tonumber(kv.fh)
    m.masked = kv.masked == "1"
  else
    m.tw = tonumber(kv.tw)
  end
  return m
end

function cpc.set_meta(sprite, m)
  sprite.data = cpc.encode_meta(m)
end

-- A name that is safe in a file name and as a BASIC identifier prefix.
function cpc.clean_name(s)
  s = tostring(s or ""):gsub("[^%w_]", "_")
  if s == "" then s = "art" end
  if s:match("^%d") then s = "_" .. s end
  return s
end

-- ---------------------------------------------------------------- palettes

-- Palette index of pen 0 in a sprite made by `meta`.
local function pen_offset(meta)
  return (meta.kind == "sprite" and meta.masked) and 1 or 0
end

local function make_palette(mode, masked)
  local pens = cpc.DEFAULT_PENS[mode]
  local off = masked and 1 or 0
  local pal = Palette(#pens + off)
  if masked then pal:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 }) end
  for p = 1, #pens do
    local r, g, b = cpc.fw_rgb(pens[p])
    pal:setColor(p - 1 + off, Color{ r = r, g = g, b = b })
  end
  return pal
end

-- Firmware colour numbers in pen order, read from the sprite palette.
function cpc.pens_of(sprite, meta)
  local pal = sprite.palettes[1]
  local off = pen_offset(meta)
  local out = {}
  for p = 0, cpc.PENS[meta.mode] - 1 do
    local i = p + off
    if i >= #pal then break end
    local c = pal:getColor(i)
    out[#out + 1] = cpc.nearest_fw(c.red, c.green, c.blue)
  end
  return out
end

-- ---------------------------------------------------------------- new

-- Fills every frame of the sprite's first layer with pen 0 (palette index 0).
-- Used for sprites that are not masked, so the canvas starts as pen 0, the
-- background pen, instead of see-through.
local function fill_pen0(sprite)
  local layer = sprite.layers[1]
  for _, frame in ipairs(sprite.frames) do
    local cel = layer:cel(frame)
    if cel then
      cel.image:clear(0)
    else
      local img = Image(ImageSpec{ width = sprite.width, height = sprite.height,
                                   colorMode = ColorMode.INDEXED,
                                   transparentColor = sprite.transparentColor })
      img:clear(0)
      sprite:newCel(layer, frame, img, Point(0, 0))
    end
  end
end

-- Creates an indexed sprite of one frame size with `frames` frames.
--   o = { mode, w, h, frames, masked, name }       (w and h in pixels)
-- Returns the sprite, or nil and a message.
function cpc.new_sprite(o)
  local mode = o.mode
  if cpc.PPB[mode] == nil then return nil, "mode must be 0, 1 or 2" end
  local w, h, n = o.w, o.h, o.frames
  if w < cpc.PPB[mode] or w % cpc.PPB[mode] ~= 0 then
    return nil, "width must be a multiple of " .. cpc.PPB[mode] .. " pixels in mode " .. mode
  end
  if w // cpc.PPB[mode] > 255 or h < 1 or h > 255 then
    return nil, "a sprite is at most 255 bytes wide and 255 lines high"
  end
  if n < 1 then return nil, "at least one frame" end
  local masked = o.masked and true or false

  local spec = ImageSpec{ width = w, height = h, colorMode = ColorMode.INDEXED,
                          transparentColor = masked and 0 or 255 }
  local sprite = Sprite(spec)
  sprite:setPalette(make_palette(mode, masked))
  sprite.transparentColor = masked and 0 or 255
  sprite.pixelRatio = cpc.pixel_ratio(mode)
  sprite.gridBounds = Rectangle(0, 0, w, h)
  for f = 2, n do sprite:newEmptyFrame(f) end
  if not masked then fill_pen0(sprite) end
  cpc.set_meta(sprite, { kind = "sprite", mode = mode, name = cpc.clean_name(o.name),
                         fw = w, fh = h, masked = masked })
  return sprite
end

-- Creates an indexed sprite with a tilemap layer whose tileset grid is
-- tw x 8. The canvas is sized for `count` tiles (a hint: tiles are added as
-- they are drawn).
--   o = { mode, tw, count, name }
function cpc.new_tileset(o)
  local mode, tw = o.mode, o.tw
  if cpc.PPB[mode] == nil then return nil, "mode must be 0, 1 or 2" end
  if not cpc.is_tile_width(mode, tw) then
    local t = cpc.tile_widths(mode)
    return nil, "tile width must be " .. t[1] .. ", " .. t[2] .. " or " .. t[3] .. " in mode " .. mode
  end
  local count = math.max(1, o.count or 16)
  local cols = math.min(count, 16)
  local rows = (count + cols - 1) // cols
  local spec = ImageSpec{ width = cols * tw, height = rows * cpc.TILE_H,
                          colorMode = ColorMode.INDEXED, transparentColor = 255 }
  local sprite = Sprite(spec)
  sprite:setPalette(make_palette(mode, false))
  sprite.transparentColor = 255
  sprite.pixelRatio = cpc.pixel_ratio(mode)
  sprite.gridBounds = Rectangle(0, 0, tw, cpc.TILE_H)
  -- NewLayer works on the active sprite.
  app.sprite = sprite
  app.command.NewLayer{ tilemap = true, name = "Ground" }
  sprite:deleteLayer(sprite.layers[1])   -- the plain "Layer 1" made with the sprite
  cpc.set_meta(sprite, { kind = "tiles", mode = mode, name = cpc.clean_name(o.name), tw = tw })
  return sprite
end

-- ---------------------------------------------------------------- pixels

local TILE_MASK = 0x1FFFFFFF   -- tilemap pixel = tile index (low 29 bits) + flip/rotate flags

-- A function px(v) -> r, g, b, a for raw pixel values v of images of this
-- sprite (alpha 0 = transparent).
local function pixel_reader(sprite)
  local pc = app.pixelColor
  local mode = sprite.colorMode
  if mode == ColorMode.INDEXED then
    local pal, tc = sprite.palettes[1], sprite.transparentColor
    local cache = {}
    return function(v)
      local c = cache[v]
      if c == nil then
        if v == tc then
          c = { 0, 0, 0, 0 }
        elseif v >= #pal then
          c = { 0, 0, 0, 255 }        -- no such palette entry; check() reports it
        else
          local col = pal:getColor(v)
          c = { col.red, col.green, col.blue, col.alpha }
        end
        cache[v] = c
      end
      return c[1], c[2], c[3], c[4]
    end
  elseif mode == ColorMode.GRAY then
    return function(v)
      local g = pc.grayaV(v)
      return g, g, g, pc.grayaA(v)
    end
  end
  return function(v)
    return pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v), pc.rgbaA(v)
  end
end

-- The flattened frame as an image in the sprite's colour mode (transparent
-- where nothing is drawn).
local function render_frame(sprite, frameNumber)
  local spec = ImageSpec(sprite.spec)
  spec.width, spec.height = sprite.width, sprite.height
  local img = Image(spec)
  if sprite.colorMode == ColorMode.INDEXED then img:clear(sprite.transparentColor) end
  img:drawSprite(sprite, frameNumber)
  return img
end

-- The tilemap layer to use: `layer` if it is one, else the first.
local function tilemap_layer(sprite, layer)
  if layer and layer.isTilemap then return layer end
  local function find(layers)
    for _, l in ipairs(layers) do
      if l.isTilemap then return l end
      if l.isGroup then
        local r = find(l.layers)
        if r then return r end
      end
    end
  end
  return find(sprite.layers)
end

-- ---------------------------------------------------------------- check

-- Checks a sprite against the import tools' rules. Returns
--   { errors = {...}, warnings = {...}, info = {...}, meta = meta,
--     bad = { {x=, y=}, ... } }
-- `bad` lists pixels of frame `opts.frame` (default 1) whose colour is not
-- a firmware colour, for selection. `meta` is the sprite's settings; for
-- sprites not made by CPCBuild pass `opts.meta`.
function cpc.check(sprite, opts)
  opts = opts or {}
  local meta = opts.meta or cpc.get_meta(sprite)
  local rep = { errors = {}, warnings = {}, info = {}, bad = {}, meta = meta }
  local function err(s) rep.errors[#rep.errors + 1] = s end
  local function warn(s) rep.warnings[#rep.warnings + 1] = s end
  local function info(s) rep.info[#rep.info + 1] = s end
  if meta == nil then
    err("this sprite has no CPCBuild settings (make it with File > CPCBuild > New, or give a mode)")
    return rep
  end
  local mode = meta.mode
  local ppb, pens = cpc.PPB[mode], cpc.PENS[mode]
  local off = pen_offset(meta)
  info("mode " .. mode .. ": " .. pens .. " pens, " .. ppb .. " pixels per byte")

  -- Size rules.
  local tmlayer
  if meta.kind == "sprite" then
    if sprite.width % ppb ~= 0 then
      err("frame width " .. sprite.width .. " is not a multiple of " .. ppb .. " (pixels per byte in mode " .. mode .. ")")
    elseif sprite.width // ppb > 255 then
      err("frame is " .. (sprite.width // ppb) .. " bytes wide; the limit is 255")
    end
    if sprite.height > 255 then err("frame is " .. sprite.height .. " lines high; the limit is 255") end
    if meta.fw and (meta.fw ~= sprite.width or meta.fh ~= sprite.height) then
      warn("the sprite is " .. sprite.width .. "x" .. sprite.height .. " but was created with " ..
           meta.fw .. "x" .. meta.fh .. " frames; the export uses " .. sprite.width .. "x" .. sprite.height)
    end
    info(#sprite.frames .. " frame(s) of " .. sprite.width .. "x" .. sprite.height)
  else
    if not cpc.is_tile_width(mode, meta.tw) then
      local t = cpc.tile_widths(mode)
      err("tile width " .. tostring(meta.tw) .. " is not " .. t[1] .. ", " .. t[2] .. " or " .. t[3] .. " (mode " .. mode .. ")")
    end
    tmlayer = tilemap_layer(sprite, app.layer)
    if tmlayer == nil then
      err("no tilemap layer")
      return rep
    end
    local ts = tmlayer.tileset
    local gs = ts.grid.tileSize
    if gs.width ~= meta.tw or gs.height ~= cpc.TILE_H then
      err("the tileset grid is " .. gs.width .. "x" .. gs.height .. ", expected " .. meta.tw .. "x" .. cpc.TILE_H)
    end
    info(#ts .. " tiles in the tileset (including the empty tile 0), limit " .. cpc.MAX_TILES)
    if #ts > cpc.MAX_TILES then
      err("the tileset has " .. #ts .. " tiles; TileMap takes one byte per cell, so at most " .. cpc.MAX_TILES)
    end
  end

  -- Colour rules. Collect (r,g,b) of every opaque pixel, counting by value.
  local px = pixel_reader(sprite)
  local used = {}        -- "r,g,b" -> { r, g, b, n }
  local usedIndex = {}   -- palette index -> true (indexed sprites)
  local partial = 0
  local function note(r, g, b, a, v)
    if a == 0 then return end
    if a < 255 then partial = partial + 1 end
    local k = r .. "," .. g .. "," .. b
    local u = used[k]
    if u == nil then u = { r, g, b, 0 }; used[k] = u end
    u[4] = u[4] + 1
  end
  local flags = 0
  if meta.kind == "sprite" and sprite.colorMode == ColorMode.INDEXED then
    -- Read the cels themselves: rendering drops indices that are not in the palette.
    for _, cel in ipairs(sprite.cels) do
      if not cel.layer.isTilemap then
        for it in cel.image:pixels() do
          local v = it()
          if v ~= sprite.transparentColor then usedIndex[v] = true end
        end
      end
    end
  end
  if meta.kind == "tiles" and sprite.colorMode == ColorMode.INDEXED then
    for i = 0, #tmlayer.tileset - 1 do
      for it in tmlayer.tileset:getTile(i):pixels() do
        local v = it()
        if v ~= sprite.transparentColor and i > 0 then usedIndex[v] = true end
      end
    end
  end
  if meta.kind == "sprite" then
    for f = 1, #sprite.frames do
      local img = render_frame(sprite, f)
      for it in img:pixels() do
        local v = it()
        local r, g, b, a = px(v)
        note(r, g, b, a, v)
        if f == (opts.frame or 1) and a ~= 0 and not cpc.is_firmware(r, g, b) then
          rep.bad[#rep.bad + 1] = { x = it.x, y = it.y }
        end
      end
    end
  else
    local ts = tmlayer.tileset
    for i = 0, #ts - 1 do
      for it in ts:getTile(i):pixels() do
        local v = it()
        local r, g, b, a = px(v)
        note(r, g, b, a, v)
      end
    end
    -- Flip/rotate flags on the map cells cannot be drawn on a CPC.
    for _, cel in ipairs(tmlayer.cels) do
      for it in cel.image:pixels() do
        if it() & ~TILE_MASK ~= 0 then flags = flags + 1 end
      end
    end
  end
  if partial > 0 then
    warn(partial .. " pixels are partly transparent; img2cpc.py treats alpha below 128 as transparent")
  end
  if flags > 0 then
    warn(flags .. " map cells use a flipped or rotated tile; the export writes the tile number only")
  end

  -- Colours that are not firmware colours.
  local snapped = {}
  for _, u in pairs(used) do
    if not cpc.is_firmware(u[1], u[2], u[3]) then
      err(string.format("colour #%02X%02X%02X (%d pixels) is not one of the 27 firmware colours; img2cpc.py would use firmware colour %d",
                        u[1], u[2], u[3], u[4], cpc.nearest_fw(u[1], u[2], u[3])))
    end
    snapped[cpc.nearest_fw(u[1], u[2], u[3])] = true
  end
  local nsnap = 0
  for _ in pairs(snapped) do nsnap = nsnap + 1 end
  info(nsnap .. " firmware colour(s) used")
  if nsnap > pens then
    err("mode " .. mode .. " has " .. pens .. " pens but the art uses " .. nsnap .. " colours")
  end
  if sprite.colorMode == ColorMode.INDEXED then
    for i in pairs(usedIndex) do
      if i < off or i >= off + pens then
        err("palette entry " .. i .. " is used, but the pens are entries " .. off .. " to " .. (off + pens - 1))
      end
    end
  else
    warn("the sprite is not indexed; colours are matched to firmware colours by value")
  end

  -- Pixel ratio.
  local pr, want = sprite.pixelRatio, cpc.pixel_ratio(mode)
  if pr.width ~= want.width or pr.height ~= want.height then
    warn("pixel ratio is " .. pr.width .. ":" .. pr.height .. ", mode " .. mode .. " pixels are " ..
         want.width .. ":" .. want.height)
  end
  return rep
end

-- Replaces the selection with the offending pixels of a report; returns how
-- many there are.
function cpc.select_bad(sprite, rep)
  local sel = Selection()
  local run
  for _, p in ipairs(rep.bad) do
    if run and run.y == p.y and run.x + run.w == p.x then
      run.w = run.w + 1
    else
      if run then sel:add(Rectangle(run.x, run.y, run.w, 1)) end
      run = { x = p.x, y = p.y, w = 1 }
    end
  end
  if run then sel:add(Rectangle(run.x, run.y, run.w, 1)) end
  sprite.selection = sel
  return #rep.bad
end

-- ---------------------------------------------------------------- export

local function json_str(s)
  s = s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == "\\" then return "\\\\" end
    return string.format("\\u%04x", c:byte())
  end)
  return '"' .. s .. '"'
end

local function write_file(path, text)
  local f = assert(io.open(path, "wb"))
  f:write(text)
  f:close()
end

local function xml_attr(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
end

-- The sidecar text. Field order and layout are part of the format.
local function sidecar_text(meta, pens, tags)
  local t = {}
  t[#t + 1] = '  "format": "cpcbuild-image"'
  t[#t + 1] = '  "version": 1'
  t[#t + 1] = '  "kind": ' .. json_str(meta.kind == "sprite" and "sprite" or "tiles")
  t[#t + 1] = '  "mode": ' .. meta.mode
  t[#t + 1] = '  "name": ' .. json_str(meta.name)
  if meta.kind == "sprite" then
    t[#t + 1] = '  "frame": ' .. json_str(meta.fw .. "x" .. meta.fh)
    t[#t + 1] = '  "masked": ' .. (meta.masked and "true" or "false")
  else
    t[#t + 1] = '  "tileWidth": ' .. meta.tw
  end
  local ps = {}
  for i, p in ipairs(pens) do ps[i] = tostring(p) end
  t[#t + 1] = '  "palette": [' .. table.concat(ps, ", ") .. ']'
  if meta.kind == "sprite" then
    local ts = {}
    for i, tag in ipairs(tags) do
      ts[i] = '    {"name": ' .. json_str(tag.name) .. ', "from": ' .. tag.from .. ', "to": ' .. tag.to .. '}'
    end
    if #ts == 0 then
      t[#t + 1] = '  "tags": []'
    else
      t[#t + 1] = '  "tags": [\n' .. table.concat(ts, ",\n") .. '\n  ]'
    end
  end
  return "{\n" .. table.concat(t, ",\n") .. "\n}\n"
end

-- Saves an RGBA sheet of `count` cells of cw x ch, `cols` per row, cell i at
-- column i % cols, row i // cols, each drawn by draw(sheet, x, y, i).
local function save_sheet(path, count, cw, ch, cols, draw)
  local rows = (count + cols - 1) // cols
  local sheet = Image(ImageSpec{ width = cols * cw, height = rows * ch, colorMode = ColorMode.RGB })
  sheet:clear(app.pixelColor.rgba(0, 0, 0, 0))
  for i = 0, count - 1 do
    draw(sheet, (i % cols) * cw, (i // cols) * ch, i)
  end
  sheet:saveAs(path)
  return cols * cw, rows * ch
end

-- Copies a source image (raw values, converted by px) into an RGBA sheet.
local function blit(sheet, src, px, ox, oy)
  local rgba = app.pixelColor.rgba
  for it in src:pixels() do
    local r, g, b, a = px(it())
    if a ~= 0 then sheet:drawPixel(ox + it.x, oy + it.y, rgba(r, g, b, a)) end
  end
end

-- The TMX text for a tilemap layer.
local function tmx_text(sprite, meta, layer, cols, count, sheetW, sheetH)
  local tw, th = meta.tw, cpc.TILE_H
  local mw = (sprite.width + tw - 1) // tw
  local mh = (sprite.height + th - 1) // th
  local cells = {}
  for i = 1, mw * mh do cells[i] = 1 end        -- tile 0 (empty) is gid 1
  local cel = layer:cel(1)
  if cel then
    local ox = (cel.position.x - layer.tileset.grid.origin.x) // tw
    local oy = (cel.position.y - layer.tileset.grid.origin.y) // th
    for it in cel.image:pixels() do
      local mx, my = ox + it.x, oy + it.y
      if mx >= 0 and mx < mw and my >= 0 and my < mh then
        cells[my * mw + mx + 1] = (it() & TILE_MASK) + 1
      end
    end
  end
  local lines = {}
  for y = 0, mh - 1 do
    local row = {}
    for x = 0, mw - 1 do row[#row + 1] = tostring(cells[y * mw + x + 1]) end
    lines[#lines + 1] = table.concat(row, ",")
  end
  local name = xml_attr(meta.name)
  return table.concat({
    '<?xml version="1.0" encoding="UTF-8"?>',
    string.format('<map version="1.10" orientation="orthogonal" renderorder="right-down" width="%d" height="%d" tilewidth="%d" tileheight="%d" infinite="0" nextlayerid="2" nextobjectid="1">',
                  mw, mh, tw, th),
    string.format(' <tileset firstgid="1" name="%s" tilewidth="%d" tileheight="%d" tilecount="%d" columns="%d">', name, tw, th, count, cols),
    string.format('  <image source="%s.png" width="%d" height="%d"/>', name, sheetW, sheetH),
    ' </tileset>',
    string.format(' <layer id="1" name="%s" width="%d" height="%d">', xml_attr(layer.name), mw, mh),
    '  <data encoding="csv">',
    table.concat(lines, ",\n"),
    '  </data>',
    ' </layer>',
    '</map>',
    '',
  }, "\n")
end

-- Exports a sprite or tileset.
--   o = { dir = folder, name = optional override of the stored name,
--         tmx = bool (tilesets), layer = tilemap layer, force = bool,
--         meta = settings for sprites not made by CPCBuild }
-- Returns { files = {paths}, report = check report, sheet = {w=, h=, cols=, count=} }
-- or nil, a message and the report (problems found by the check, unless
-- `force`).
function cpc.export(sprite, o)
  local rep = cpc.check(sprite, { meta = o.meta })
  local meta = rep.meta
  if meta == nil then return nil, rep.errors[1], rep end
  if #rep.errors > 0 and not o.force then
    return nil, "the sprite has problems:\n" .. table.concat(rep.errors, "\n"), rep
  end
  if o.name and o.name ~= "" then
    meta = setmetatable({ name = cpc.clean_name(o.name) }, { __index = meta })
  end
  local base = app.fs.joinPath(o.dir, meta.name)
  local files = {}
  local px = pixel_reader(sprite)
  local info

  if meta.kind == "sprite" then
    local n = #sprite.frames
    local cols = cpc.sheet_cols(n)
    local w, h = save_sheet(base .. ".png", n, sprite.width, sprite.height, cols,
      function(sheet, x, y, i)
        blit(sheet, render_frame(sprite, i + 1), px, x, y)
      end)
    info = { w = w, h = h, cols = cols, count = n }
    local tags = {}
    for _, tag in ipairs(sprite.tags) do
      tags[#tags + 1] = { name = tag.name, from = tag.fromFrame.frameNumber - 1,
                          to = tag.toFrame.frameNumber - 1 }
    end
    local m2 = setmetatable({ fw = sprite.width, fh = sprite.height }, { __index = meta })
    write_file(base .. ".cpcbuild.json", sidecar_text(m2, cpc.pens_of(sprite, meta), tags))
    files[#files + 1] = base .. ".png"
    files[#files + 1] = base .. ".cpcbuild.json"
  else
    local layer = tilemap_layer(sprite, o.layer or app.layer)
    local ts = layer.tileset
    local n = #ts
    local cols = cpc.sheet_cols(n)
    local w, h = save_sheet(base .. ".png", n, meta.tw, cpc.TILE_H, cols,
      function(sheet, x, y, i)
        -- tile 0 is Aseprite's empty tile: left blank (transparent)
        if i > 0 then blit(sheet, ts:getTile(i), px, x, y) end
      end)
    info = { w = w, h = h, cols = cols, count = n }
    write_file(base .. ".cpcbuild.json", sidecar_text(meta, cpc.pens_of(sprite, meta), {}))
    files[#files + 1] = base .. ".png"
    files[#files + 1] = base .. ".cpcbuild.json"
    if o.tmx then
      write_file(base .. ".tmx", tmx_text(sprite, meta, layer, cols, n, w, h))
      files[#files + 1] = base .. ".tmx"
    end
  end
  return { files = files, report = rep, sheet = info }
end

return cpc
